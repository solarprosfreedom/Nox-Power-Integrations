import { env } from "@/lib/env";
import { eiecEmailRecipients, formatEiecResultEmail } from "@/lib/eiec/email";
import { lookupEiecEligibility } from "@/lib/eiec/feature-server";
import { extractAddressFromIdImage, type GptIdAddress } from "@/lib/eiec/gpt-address";
import {
  hasIllinoisHomeAddress,
  parseSequifiHomeAddress,
  sequifiAddressMatchesId,
} from "@/lib/eiec/home-address";
import { screenshotEiecInstantApp } from "@/lib/eiec/instant-app-screenshot";
import {
  eiecEligibleFolderName,
  loadProcessedLedger,
  saveProcessedLedger,
  uploadTestFile,
} from "@/lib/eiec/sharepoint-test";
import { downloadSequifiIdPhoto } from "@/lib/eiec/sequifi-id";
import { isGraphMailConfigured, sendMailAsUser } from "@/lib/microsoft/graph-mail";
import {
  fetchAllSequifiUsers,
  fetchSequifiUserByIdAnyStatus,
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
  addressMatchesId?: boolean | null;
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
    const user = await fetchSequifiUserByIdAnyStatus(options.forceUserId);
    candidates = user ? [user] : [];
  } else {
    const hired = filterUsersByOnboardingComplete(
      filterUsersByGoLive(await fetchAllSequifiUsers()),
    );
    candidates = hired.filter(
      (user) => hasIllinoisHomeAddress(user) && !ledger.users[String(user.id)],
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
  const home = parseSequifiHomeAddress(user);
  const idFile = await downloadSequifiIdPhoto(user.id);

  let idAddress: GptIdAddress | null = null;
  let idReason: string | undefined;
  if (!idFile) {
    idReason = "no ID document";
  } else if (idFile.mimeType === "application/pdf") {
    idReason = "ID is PDF (vision needs an image)";
  } else {
    idAddress = await extractAddressFromIdImage(idFile.bytes, idFile.mimeType);
    if (!idAddress.readable) idReason = "ID address unreadable";
  }

  const lookupAddress = home?.formatted || (idAddress?.readable ? idAddress.formatted : "");
  if (!lookupAddress) {
    return finish(user, ledger, {
      name,
      eligible: false,
      skipped: false,
      reason: idReason ?? "no address to check",
      addressMatchesId: sequifiAddressMatchesId(home, idAddress),
    });
  }

  const lookup = await lookupEiecEligibility(lookupAddress);
  const addressMatchesId = sequifiAddressMatchesId(home, idAddress);
  let folderCreated = false;
  if (lookup.eligible) {
    const folder = eiecEligibleFolderName(name, addressMatchesId);
    if (idFile && idFile.mimeType !== "application/pdf") {
      await uploadTestFile(
        `${folder}/Photo Of Driver's License Or Passport${extFor(idFile.fileName, idFile.mimeType)}`,
        idFile.bytes,
        idFile.mimeType,
      );
    }
    try {
      const shot = await screenshotEiecInstantApp(lookupAddress);
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
    address: lookupAddress,
    addressMatchesId,
    folderCreated,
    reason: idReason,
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
    const to = eiecEmailRecipients(env.eiecEmailTo);
    await sendMailAsUser({
      to,
      subject: `Illinois EIEC: ${result.name} — ${result.eligible ? "yes" : "no"}`,
      body: formatEiecResultEmail({
        name: result.name,
        eligible: result.eligible,
        addressMatchesId: result.addressMatchesId,
      }),
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
