export const PLACEHOLDERS = [252, 253, 260, 261, 262, 263, 265, 266];

export function idToCode(id) {
  if (id >= 251 && id <= 259) return `F${id - 250}`; // 252 -> F2
  if (id >= 260 && id <= 269) return `S${id - 260}`; // 260 -> S0
  return String(id);
}