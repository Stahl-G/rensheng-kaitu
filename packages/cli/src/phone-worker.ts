import { readFileSync } from "node:fs";
import { runPhone } from "@kaitu/core/phone-run";

const input = JSON.parse(readFileSync(process.argv[2] as string, "utf8"));
console.log(JSON.stringify(await runPhone(input.root, input.generator, input.history, input.inputs)));
