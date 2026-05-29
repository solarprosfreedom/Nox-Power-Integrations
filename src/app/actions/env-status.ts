"use server";

import { env } from "@/lib/env";

/** Booleans only — never exposes key values to the client. */
export async function getIntegrationEnvStatus(): Promise<{
  enerflo: boolean;
  terros: boolean;
  sequifi: boolean;
  coperniq: boolean;
}> {
  return {
    enerflo: Boolean(env.enerfloV1ApiKey?.trim()),
    terros: Boolean(env.terrosApiKey?.trim()),
    sequifi: Boolean(
      env.sequifiAccessToken?.trim() || env.sequifiApiKey?.trim(),
    ),
    coperniq: Boolean(env.coperniqApiKey?.trim()),
  };
}
