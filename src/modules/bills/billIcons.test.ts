import { describe, it, expect } from "vitest";
import { Baby, Car, Receipt, Wifi, House } from "lucide-react";
import { billIconFor } from "./billIcons";

describe("bill icons", () => {
  it("uses the setup preset when there is one", () => {
    expect(billIconFor("Anything", "rent")[0]).toBe(House);
  });
  it("matches saved bills by name without catching words inside words", () => {
    expect(billIconFor("Daycare")[0]).toBe(Baby);
    expect(billIconFor("Car payment")[0]).toBe(Car);
    expect(billIconFor("Xfinity internet")[0]).toBe(Wifi);
    expect(billIconFor("Mystery bill")[0]).toBe(Receipt);
  });
});
