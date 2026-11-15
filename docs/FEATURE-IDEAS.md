# Feature Ideas (from research)

These are the features gathered from open-source gift apps, spreadsheet templates, and commercial gift-tracking apps, and what we decided about each. The phase numbers match [PLAN.md](PLAN.md).

## In scope
| Feature | Inspired by | Phase |
|---|---|---|
| Budget per person and overall, with spent, committed, and remaining (one shared pot) | Financial Aha, Payhip, Producing Paradise, Santa's Bag | 1 |
| Store, order number, and tracking link per gift | Spreadsheet Daddy, GiftList | 1 |
| Status pipeline: idea → planned → ordered → received → wrapped → given / returned | Spreadsheet Daddy, Getly, Santa's Bag | 1 |
| Return-by dates that turn amber, then red | Etsy tracker template | 1 |
| Main vs. stocking gift type, with a stocking count per person | Airtable template, Christmas Gift List Tracker | 1 |
| Person profiles with sizes, likes, and dislikes | Gifted | 1 |
| Surprise rule: gifts for one of us are hidden from that person | Christmas Gift List Tracker, Giftster | 1 |
| Anyone can add ideas for anyone | GiftFlow | 1 |
| Fairness strip: the kids side by side by $ and number of gifts | (ours) | 1 |
| "Committed" money shown separately from "spent" | (ours) | 1 |
| Wishlist flag: the kid asked for it | Giftster, Wishlist | 1 |
| Separate stocking budget | Gifted | 2 |
| Shopping list grouped by store | The Christmas List | 2 |
| Givers checklist (does every kid have a gift for everyone?) | (ours) | 2 |
| Wrapping and Christmas Eve checklist | (ours) | 2 |
| Year-round ideas inbox | (ours) | 2 |
| Recent-activity feed | (ours) | 2 |
| Paste a link to auto-fill the title, image, and price | Christmas Community | 2 |
| CSV import and export | (ours) | 2 |
| Table view and card view | Christmas Community | 2 |
| Dark mode and a holiday theme | (ours) | 2 |
| Gift history by year and by person, plus a "given before" warning | Gifted, GiftFlow | 3 |
| Kids' name draw (Secret Santa style) | Elfster, Giftster | 3 |
| Receipt photo upload | (ours) | 3 |
| Profile pictures / avatars | Christmas Community | 3 |
| Markdown notes | Christmas Community | 3 |
| Price-drop watch on saved links | (ours) | 3 |
| Weekly email digest | (ours) | 3 |
| Passkeys / Face ID sign-in | Christmas Gift List Tracker (app lock) | 3 |
| Birthday and anniversary seasons | (ours) | 3 |

## Left out (by decision)
| Feature | Why |
|---|---|
| Read-only guest link for grandparents | Not wanted |
| Hiding-spot field | Not wanted |
| Purchased-by / payer / reimbursement tracking (GiftFlow) | One shared pot |
| Google / OIDC sign-in (Christmas Community) | We're using the app's own email and password login |

## Sources
- Open source: [GiftFlow](https://github.com/garnajee/giftflow), [Christmas Community](https://github.com/Wingysam/Christmas-Community), [Wishlist (ElfHosted docs)](https://docs.elfhosted.com/app/wishlist/), [Pønskelisten](https://selfhostyourself.com/services/poenskelisten), [Geeftlist](https://selfhostyourself.com/services/geeftlist), [selfhostyourself: Giftster alternatives](https://selfhostyourself.com/alternative-to/giftster)
- Spreadsheets: [Spreadsheet Daddy](https://spreadsheetdaddy.com/templates/christmas-shopping-list-spreadsheet), [Financial Aha](https://www.financialaha.com/free-spreadsheet-templates/special-purpose/christmas-budget), [Producing Paradise](https://www.producingparadise.com/workflows/how-to-manage-your-christmas-gift-budget-and-ideas-using-google-sheets), [Etsy tracker](https://www.etsy.com/listing/4593832964), [Payhip](https://payhip.com/b/smz7l), [Getly](https://www.getly.store/product/christmas-gift-budget-gift-list-spreadsheet-xlsx-holiday-shopping-tracker)
- Apps: [Santa's Bag](https://apps.apple.com/us/app/santas-bag/id397698040), [Gifted](https://apps.apple.com/app/gifted/id543667653), [Christmas Gift List Tracker](https://apps.apple.com/app/id1444504033), [The Christmas Gift List Pro](https://apps.apple.com/us/app/id755493890), [GiftList](https://apps.apple.com/us/app/id1440596904), [GiftList blog roundup](https://giftlist.com/blog/best-apps-for-tracking-holiday-wish-lists-2025), [Livingetc roundup](https://livingetc.com/advice/best-Christmas-list-organizing-apps)
- Hosting: [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [D1 free-tier enforcement (Sept 2026)](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/), [Hostinger: MySQL with Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/), [Hostinger + Cloudflare DNS](https://support.hostinger.com/en/articles/6865646-how-to-point-a-domain-to-hostinger-website-builder-via-cloudflare), [Hostinger Node.js docs](https://docs.hostinger.com/node.js/github) (not fetched directly; see the note in PLAN.md)
