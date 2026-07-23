import { existsSync } from "node:fs";
import { dirname, extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const candidates = ["", ".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.tsx", "/index.js"];

export async function resolve(specifier, context, defaultResolve) {
  if (specifier === "next/server" || specifier === "next/navigation") {
    return {
      url: pathToFileURL(resolvePath(root, "node_modules", "next", `${specifier.slice(5)}.js`)).href,
      shortCircuit: true,
    };
  }

  if (specifier.startsWith("@/")) {
    const basePath = resolvePath(root, "src", specifier.slice(2));
    for (const suffix of candidates) {
      const filePath = `${basePath}${suffix}`;
      if (existsSync(filePath)) {
        return { url: pathToFileURL(filePath).href, shortCircuit: true };
      }
    }
  }

  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !extname(specifier)) {
    const parentPath = context.parentURL ? fileURLToPath(context.parentURL) : resolvePath(root, "index.js");
    const basePath = resolvePath(dirname(parentPath), specifier);
    for (const suffix of candidates) {
      const filePath = `${basePath}${suffix}`;
      if (existsSync(filePath)) {
        return { url: pathToFileURL(filePath).href, shortCircuit: true };
      }
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}
