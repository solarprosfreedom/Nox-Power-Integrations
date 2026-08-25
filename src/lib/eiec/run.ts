import { env } from "@/lib/env";
import { formatEiecResultEmail } from "@/lib/eiec/email";
import { lookupEiecEligibility } from "@/lib/eiec/feature-server";
import { extractAddressFromIdImage } from "@/lib/eiec/gpt-address";
import { isIllinoisSellingMarket } from "@/lib/eiec/illinois-market";
import { screenshotEiecInstantApp } from "@/lib/eiec/instant-app-screenshot";
import {
  loadProcessedLedger,
  safeRepFolderName,
  saveProcessedLedger,
  uploadTestFile,
} from "@/lib/eiec/sharepoint-test";
import { downloadSequifiIdPhoto } from "@/lib/eiec/sequifi-id";
import { isGraphMailConfigured, sendMailAsUser } from "@/lib/microsoft/graph-mail";
import {
  fetchAllSequifiUsers,
  fetchSequifiUserById,
  filterUsersByGoLive,
  filterUsersByOnboardingComplete,
} from "@/lib/sequifi/client";
import type { SequifiUserRecord } from "@/lib/onboarding/types";

export type EiecRunResult = {
  name: string;
  sequifiUserId: number;
  eligible: boolean;
  skipped: boolean;
  reason?: string;
  address?: string;
  folderCreated?: boolean;
  emailed?: boolean;
};

function displayName(user: SequifiUserRecord): string {
  return `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || `Sequifi ${user.id}`;
}

export async function runEiecEligibilityCycle(options?: {
  limit?: number;
  forceUserId?: number;
}): Promise<{ processed: EiecRunResult[]; checked: number }> {
  const limit = Math.max(1, options?.limit ?? 1);
  const ledger = await loadProcessedLedger();
  let candidates: SequifiUserRecord[];
  if (options?.forceUserId) {
    const user = await fetchSequifiUserById(options.forceUserId);
    candidates = user && isIllinoisSellingMarket(user.raw) ? [user] : [];
  } else {
    const hired = filterUsersByOnboardingComplete(
      filterUsersByGoLive(await fetchAllSequifiUsers()),
    );
    candidates = hired.filter(
      (user) => isIllinoisSellingMarket(user.raw) && !ledger.users[String(user.id)],
    );
  }

  const processed: EiecRunResult[] = [];
  for (const user of candidates.slice(0, limit)) {
    processed.push(await processUser(user, ledger));
  }
  await saveProcessedLedger(ledger);
  return { processed, checked: candidates.length };
}

async function processUser(
  user: SequifiUserRecord,
  ledger: Awaited<ReturnType<typeof loadProcessedLedger>>,
): Promise<EiecRunResult> {
  const name = displayName(user);
  const idFile = await downloadSequifiIdPhoto(user.id);
  if (!idFile) {
    const result = await finish(user, ledger, {
      name,
      eligible: false,
      skipped: false,
      reason: "no ID document",
    });
    return result;
  }
  if (idFile.mimeType === "application/pdf") {
    return finish(user, ledger, {
      name,
      eligible: false,
      skipped: false,
      reason: "ID is PDF (vision needs an image)",
    });
  }

  const address = await extractAddressFromIdImage(idFile.bytes, idFile.mimeType);
  if (!address.readable) {
    return finish(user, ledger, {
      name,
      eligible: false,
      skipped: false,
      reason: "ID address unreadable",
    });
  }

  const lookup = await lookupEiecEligibility(address.formatted);
  let folderCreated = false;
  if (lookup.eligible) {
    const folder = `${safeRepFolderName(name)} (Eligible)`;
    await uploadTestFile(
      `${folder}/Photo Of Driver's License Or Passport${extFor(idFile.fileName, idFile.mimeType)}`,
      idFile.bytes,
      idFile.mimeType,
    );
    try {
      const shot = await screenshotEiecInstantApp(address.formatted);
      await uploadTestFile(`${folder}/EIEC map screenshot.png`, shot.png, "image/png");
    } catch (err) {
      await uploadTestFile(
        `${folder}/EIEC map screenshot FAILED.txt`,
        Buffer.from(err instanceof Error ? err.message : String(err), "utf8"),
        "text/plain",
      );
    }
    folderCreated = true;
  }

  return finish(user, ledger, {
    name,
    eligible: lookup.eligible,
    skipped: false,
    address: address.formatted,
    folderCreated,
  });
}

async function finish(
  user: SequifiUserRecord,
  ledger: Awaited<ReturnType<typeof loadProcessedLedger>>,
  result: Omit<EiecRunResult, "sequifiUserId">,
): Promise<EiecRunResult> {
  ledger.users[String(user.id)] = {
    at: new Date().toISOString(),
    name: result.name,
    eligible: result.eligible,
    reason: result.reason,
  };
  let emailed = false;
  if (isGraphMailConfigured()) {
    const to = env.eiecEmailTo?.trim() || "noxpwr@gmail.com";
    await sendMailAsUser({
      to,
      subject: `Illinois EIEC: ${result.name} — ${result.eligible ? "yes" : "no"}`,
      body: formatEiecResultEmail({ name: result.name, eligible: result.eligible }),
    });
    emailed = true;
  }
  return { ...result, sequifiUserId: user.id, emailed };
}

function extFor(fileName: string, mime: string): string {
  const m = fileName.match(/\.(jpe?g|png|webp|heic)$/i);
  if (m) return m[0]!.toLowerCase() === ".jpeg" ? ".jpg" : m[0]!.toLowerCase();
  if (mime.includes("png")) return ".png";
  return ".jpg";
}
