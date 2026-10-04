import { ConvexError } from "convex/values";

export function requireInventoryPin(pin?: string) {
  const expected = process.env.INVENTORY_PIN;
  if (!expected) throw new ConvexError("Inventory editing has not been configured.");
  if (!pin || pin.length > 64) throw new ConvexError("Enter the correct PIN.");
  let different = pin.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) {
    different |= (pin.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  }
  if (different !== 0) throw new ConvexError("Enter the correct PIN.");
}
