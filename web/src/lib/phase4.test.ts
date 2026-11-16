import { describe, expect, it } from "vitest";
import type { Season, UserSummary, WishItem } from "../api";
import { giftQueryString } from "../api";
import {
  emptyWishlistText,
  isForSelfOnly,
  linkHost,
  otherUsersLabel,
  removeConfirmText,
  wishBadgeText,
  wishChanges,
  wishFormFrom,
  wishInputFrom,
  wishOwnerName,
  wishSeasons,
} from "./wishlist";

const users: UserSummary[] = [
  { id: 1, displayName: "Alex", personId: 10 },
  { id: 2, displayName: "Robin", personId: 11 },
];

const wish: WishItem = {
  id: 5,
  title: "Socks",
  description: "",
  url: "https://www.shop.example.com/socks",
  imageUrl: "",
  category: "main",
  priority: 2,
  estPriceCents: 1500,
  seasonId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

describe("wishlist helpers", () => {
  it("names the wishlist owner from GET /users, only for wishlist items", () => {
    expect(wishOwnerName({ isWishlistItem: true, createdBy: 2 }, users)).toBe("Robin");
    expect(wishOwnerName({ isWishlistItem: false, createdBy: 2 }, users)).toBeNull();
    expect(wishOwnerName({ isWishlistItem: true, createdBy: 99 }, users)).toBeNull();
    expect(wishBadgeText("Robin")).toBe("From Robin’s wishlist");
    expect(wishBadgeText(null)).toBe("From their wishlist");
  });

  it("names the other users for the confirm and empty-state copy", () => {
    expect(otherUsersLabel(users, 1)).toBe("Robin");
    expect(otherUsersLabel([...users, { id: 3, displayName: "Sam", personId: null }], 1)).toBe("Robin & Sam");
    expect(otherUsersLabel([users[0]!], 1)).toBeNull();
    expect(removeConfirmText("Robin")).toBe("Robin will see that you no longer want this.");
    expect(emptyWishlistText("Robin")).toBe("Add things you'd love. Robin sees them; you'll never see if they were bought.");
    expect(emptyWishlistText("Robin & Sam")).toContain("Robin & Sam see them");
    expect(emptyWishlistText(null)).toContain("Your family sees them");
  });

  it("detects a gift for yourself alone", () => {
    expect(isForSelfOnly({ isFamily: false, recipientIds: [10] }, 10)).toBe(true);
    expect(isForSelfOnly({ isFamily: false, recipientIds: [10, 11] }, 10)).toBe(false);
    expect(isForSelfOnly({ isFamily: true, recipientIds: [] }, 10)).toBe(false);
    expect(isForSelfOnly({ isFamily: false, recipientIds: [10] }, null)).toBe(false);
  });

  it("offers only upcoming, unarchived seasons", () => {
    const s = (id: number, date: string, archived = false) => ({ id, date, archived }) as Season;
    expect(wishSeasons([s(1, "2026-12-25"), s(2, "2025-12-25"), s(3, "2027-01-01", true), s(4, "2026-11-16")], "2026-11-16").map((x) => x.id)).toEqual([1, 4]);
  });

  it("builds and validates the request, sending only changes on edit", () => {
    const f = wishFormFrom(wish);
    expect(f.est).toBe("15");
    const r = wishInputFrom({ ...f, title: " Wool socks ", est: "12" });
    expect(r).toEqual({ input: expect.objectContaining({ title: "Wool socks", estPriceCents: 1200, seasonId: null }) });
    if ("input" in r) expect(wishChanges(wish, r.input)).toEqual({ title: "Wool socks", estPriceCents: 1200 });
    expect(wishInputFrom({ ...f, title: "  " })).toEqual({ error: "What would you love?" });
    expect(wishInputFrom({ ...f, est: "abc" })).toHaveProperty("error");
    expect(wishInputFrom({ ...f, url: "javascript:alert(1)" })).toHaveProperty("error");
    // Nothing about planning or buying is ever sent.
    if ("input" in r) expect(Object.keys(r.input).sort()).toEqual(["category", "description", "estPriceCents", "imageUrl", "priority", "seasonId", "title", "url"]);
  });

  it("formats links and the gift filter", () => {
    expect(linkHost(wish.url)).toBe("shop.example.com");
    expect(giftQueryString({ wishlist: true, seasonId: 3 })).toBe("?seasonId=3&wishlist=1");
  });
});
