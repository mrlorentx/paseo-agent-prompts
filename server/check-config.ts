import { resolve } from "node:path";
import {
  defaultBindingsPath,
  readBindings,
  readRolePrompt,
} from "./configuration.ts";

if (process.argv[2] === "--help") {
  console.log("Usage: npm run check-config -- [path/to/bindings.json]");
  console.log("Defaults to $PASEO_HOME/agent-system-prompt/bindings.json.");
  console.log("PASEO_HOME defaults to ~/.paseo.");
} else {
  const bindingsPath = process.argv[2]
    ? resolve(process.argv[2])
    : defaultBindingsPath();

  try {
    const bindings = await readBindings(bindingsPath);
    const prompts = await Promise.all(
      Object.entries(bindings).map(async ([provider, configuredPath]) => ({
        provider,
        ...(await readRolePrompt(bindingsPath, provider, configuredPath)),
      })),
    );
    for (const prompt of prompts) {
      console.log(`${prompt.provider}: OK (${prompt.path})`);
    }
    console.log(`Validated ${prompts.length} binding(s) in ${bindingsPath}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
