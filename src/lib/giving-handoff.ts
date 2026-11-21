let handoff: { payee: string; amount: string; expires: number } | null = null;
export function putGivingHandoff(value: { payee: string; amount: string }) {
  handoff = { ...value, expires: Date.now() + 10000 };
}
export function takeGivingHandoff() {
  const value = handoff;
  handoff = null;
  return value && value.expires > Date.now() ? value : null;
}
