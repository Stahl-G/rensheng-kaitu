import { createHash } from "node:crypto";
// Test-only gh substitute. State, credentials and repositories are synthetic.
import fs from "node:fs";
const file = process.env.KAITU_TEST_GH_STATE;
const state = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(`${file}.calls`, `${JSON.stringify(args)}\n`);
if (args[0] === "auth") process.exit(state.authenticated ? 0 : 1);
if (!state.authenticated) {
  console.error("Run gh auth login");
  process.exit(1);
}
if (args[0] === "repo") {
  if (args[1] === "view") {
    if (args[2] !== state.repo) process.exit(1);
    console.log(JSON.stringify({ nameWithOwner: state.repo, isPrivate: state.private }));
    process.exit(0);
  }
  if (state.repo) process.exit(1);
  state.repo = args.at(-1);
  state.private = args.includes("--private");
  state.description = args[args.indexOf("--description") + 1];
  fs.writeFileSync(file, JSON.stringify(state));
  process.exit(0);
}
if (args.includes("user")) {
  console.log("synthetic");
  process.exit(0);
}
const endpoint = args.find((arg) => arg.startsWith("repos/"));
const route = endpoint?.slice(`repos/${state.repo}`.length).split("?")[0] ?? "invalid";
const input = fs.readFileSync(0, "utf8");
const body = input ? JSON.parse(input) : {};
const oid = () => `object-${++state.sequence}`;
let status = 200;
let value;
if (route === "") value = { full_name: state.repo, private: state.private, default_branch: "main" };
else if (route === "/git/ref/heads/main") {
  if (!state.head) {
    status = 409;
    value = {};
  } else value = { object: { sha: state.head } };
} else if (route === "/contents/kaitu-backup.json") {
  const tree = oid();
  const sha = oid();
  state.trees[tree] = { "kaitu-backup.json": Buffer.from(body.content, "base64").toString() };
  state.commits[sha] = { tree: { sha: tree }, parent: null };
  state.head = sha;
  value = { commit: { sha, tree: { sha: tree } } };
} else if (route === "/git/trees") {
  const files = { ...state.trees[body.base_tree] };
  for (const item of body.tree) {
    if (item.sha === null) delete files[item.path];
    else files[item.path] = item.content;
  }
  const sha = oid();
  state.trees[sha] = files;
  value = { sha };
} else if (route === "/git/commits") {
  const sha = oid();
  state.commits[sha] = { tree: { sha: body.tree }, parent: body.parents[0] ?? null };
  value = { sha };
} else if (route === "/git/refs/heads/main") {
  if (body.force !== false || state.commits[body.sha].parent !== state.head) {
    status = 422;
    value = {};
  } else {
    state.head = body.sha;
    value = {};
  }
} else if (route.startsWith("/git/commits/")) value = state.commits[route.slice(13)];
else if (route.startsWith("/git/trees/"))
  value = {
    tree: Object.entries(state.trees[route.slice(11)] ?? {}).map(([path, text]) => ({
      path,
      type: "blob",
      mode: "100644",
      sha: createHash("sha1").update(text).digest("hex"),
    })),
  };
else if (route.startsWith("/git/blobs/")) {
  const text = Object.values(state.trees)
    .flatMap((files) => Object.values(files))
    .find((text) => createHash("sha1").update(text).digest("hex") === route.slice(11));
  value = { content: Buffer.from(text ?? "").toString("base64") };
} else {
  status = 404;
  value = {};
}
if (["/contents/kaitu-backup.json", "/git/trees", "/git/commits", "/git/refs/heads/main"].includes(route))
  fs.writeFileSync(file, JSON.stringify(state));
console.log(`HTTP/2.0 ${status} Test\n\n${JSON.stringify(value ?? {})}`);
if (status >= 400) process.exitCode = 1;
