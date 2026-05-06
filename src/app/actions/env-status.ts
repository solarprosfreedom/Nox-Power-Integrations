"use server";

import { env } from "@/lib/env";

/** Booleans only — never exposes key values to the client. */
export async function getIntegrationEnvStatus(): Promise<{
  enerflo: boolean;
  terros: boolean;
  sequifi: boolean;
}> {
  return {
    enerflo: Boolean(env.enerfloV1ApiKey?.trim()),
    terros: Boolean(env.terrosApiKey?.trim()),
    sequifi: Boolean(env.sequifiApiKey?.trim()),
  };
}
