// Reviewed adaptations for dsh-plugin-chatgpt-siwc 0.9.4. Fail closed on upstream changes.
// invalid_grant recovery: https://developers.openai.com/siwc/token-sharing-open-source/sign-in
// Retain only the issued public client ID in memory; never replay a rejected authorization code.
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw new Error("SIWC source changed; review compatibility adaptations");
  return source.replace(before, after);
}

export function adaptSiwcSource(path, input) {
  let source = input;
  const name = path.replaceAll("\\", "/");
  if (name.endsWith("/storage/state.js"))
    return replaceOnce(
      source,
      "return { kind: 'grant', payload: state };",
      "return { kind: 'grant', payload: JSON.parse(JSON.stringify(state)) };",
    );
  if (name.endsWith("/auth/index.js")) {
    source = replaceOnce(source, "    protocol;", "    protocol;\n    pendingClients = new Map();");
    source = replaceOnce(
      source,
      "        const state = randomBytes",
      "        if (options.reusePendingRegistration === false) this.pendingClients.delete(options.hostId);\n        const clientId = options.registration?.issuedClientId ?? this.pendingClients.get(options.hostId);\n        const state = randomBytes",
    );
    source = replaceOnce(
      source,
      "{ nonce, verifier, redirectUri, signal }",
      "{ nonce, verifier, redirectUri, signal, clientId }",
    );
    source = replaceOnce(
      source,
      "client_id: options.registration?.issuedClientId ?? 'dynamic_agent_client'",
      "client_id: clientId ?? 'dynamic_agent_client'",
    );
    source = replaceOnce(
      source,
      "if (!options.registration)\n            url.searchParams.set('agent_name_hint', 'DSH ChatGPT SIWC');",
      "if (!clientId)\n            url.searchParams.set('agent_name_hint', 'Kaitu ChatGPT SIWC');",
    );
    source = replaceOnce(
      source,
      "const issuedClientId = suppliedId ?? options.registration?.issuedClientId;",
      "const expectedClientId = options.registration?.issuedClientId ?? attempt.clientId;\n        const issuedClientId = suppliedId ?? expectedClientId;",
    );
    source = replaceOnce(
      source,
      "if (options.registration && issuedClientId !== options.registration.issuedClientId)",
      "if (expectedClientId && issuedClientId !== expectedClientId)",
    );
    source = replaceOnce(
      source,
      "throw new AuthError(error.code, error.message, error.status, issuedClientId);",
      "if (!attempt.signal.aborted) this.pendingClients.set(options.hostId, issuedClientId);\n                throw new AuthError(error.code, 'OpenAI 拒绝了本次授权码。请重新点击 Continue with ChatGPT，沿用注册身份重试。', error.status, issuedClientId);",
    );
    source = replaceOnce(
      source,
      "        return credentials(token, identity, { issuer:",
      "        this.pendingClients.delete(options.hostId);\n        return credentials(token, identity, { issuer:",
    );
    return source;
  }
  if (name.endsWith("/api/controller.js")) {
    return replaceOnce(
      source,
      "this.auth.beginSignIn({ hostId:",
      "this.auth.beginSignIn({ reusePendingRegistration: !fresh, hostId:",
    );
  }
  if (name.endsWith("/auth/loopback.js")) {
    return replaceOnce(
      source.replaceAll("DSH", "Kaitu"),
      "'Sign-in failed. Return to Kaitu to try again.'",
      "error instanceof AuthError && error.code === 'invalid_grant' ? 'This authorization code was rejected. Return to Kaitu and choose Continue with ChatGPT again.' : 'Sign-in failed. Return to Kaitu to try again.'",
    );
  }
  return source;
}
