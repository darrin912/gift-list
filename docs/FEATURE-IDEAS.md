# Feature Ideas (from research)

These are ideas gathered from open-source gift apps, spreadsheet templates, and commercial gift-tracking apps. Each is tagged with the phase where it would fit: **P1** = MVP, **P2** = soon after, **P3** = someday. Items marked ✅ are already in the [plan](PLAN.md).

## From spreadsheet templates
| Idea | Seen in | Phase |
|---|---|---|
| ✅ Budget per person vs. actual spent vs. left to spend | Financial Aha, Payhip, Producing Paradise | P1 |
| ✅ Overall total budget, spent, and remaining | Producing Paradise Google Sheets guide | P1 |
| ✅ Store/website column | Spreadsheet Daddy | P1 |
| ✅ Status pipeline: Idea → Ordered → Bought → Wrapped → Given | Spreadsheet Daddy, Getly | P1 |
| **Return-by dates** that turn amber as the deadline nears and red once it passes | Etsy gift tracker template | P2 |
| **Main vs. stocking gift type**, with a count of stocking gifts per person | Airtable stocking template | P1 |
| Import from an existing spreadsheet (CSV) | (our own need) | P2 |

## From gift-tracking apps
| Idea | Seen in | Phase |
|---|---|---|
| ✅ **Hiding-spot field**, so you know where each gift is hidden | Santa's Bag | P1 |
| ✅ Detailed statuses: ordered, received, needs to be sent, wrapped | Santa's Bag | P1 |
| ✅ Budget per contact *and* for the whole list | Santa's Bag | P1 |
| **Person profiles with clothing sizes**, likes, and dislikes | Gifted | P1 (sizes), P2 (likes) |
| Separate stocking-stuffer budget | Gifted | P2 |
| **Private / hidden gifts** (our "surprise rule") | Christmas Gift List Tracker, Giftster | P1 |
| **Face ID / app lock** (for us: Cloudflare Access or a short re-auth) | Christmas Gift List Tracker | P2 |
| Order number and tracking link per gift | GiftList | P1 |
| Shop-by-store organization | The Christmas List | P2 |
| Gift history by year, so we don't repeat a gift or can see "what did we get her last year?" | Gifted, GiftFlow | P2 |
| Wishlist reservation, so two givers don't buy the same thing | Giftster, Wishlist, Pønskelisten | P3 (kids' wishlists) |
| Secret Santa draw | Elfster, Giftster | P3 |

## From open-source projects
| Idea | Project | Phase |
|---|---|---|
| **Paste a link and the title, image, and price fill in automatically** | Christmas Community (`get-product-data`) | P2 |
| Anyone can add ideas for anyone (we'll keep that, minus the surprise rule) | GiftFlow | P1 |
| **Purchased-by / payer / reimbursement tracking** (who fronted the money) | GiftFlow | P1 (payer), P3 (reimbursement) |
| Year archive browsable by year and by person | GiftFlow | P2 |
| Table view *and* card view | Christmas Community | P2 |
| Markdown notes | Christmas Community | P3 |
| Profile pictures / avatars | Christmas Community | P3 (emoji + color in P1) |
| Read-only guest link (e.g. grandparents see the kids' wishlists) | Christmas Community, Wishlist | P3 |
| Google sign-in (OIDC) | Christmas Community | P3 (Cloudflare Access covers this) |

## Our own ideas (not seen elsewhere)
| Idea | Phase |
|---|---|
| **Fairness strip**: the kids side by side by $ and number of gifts | P1 |
| **Givers view**: "Does every kid have a gift for each sibling and each parent?", shown as a checklist matrix | P2 |
| **Christmas Eve mode**: a checklist of what goes under the tree, from whom, and where it's hidden | P2 |
| Year-round **ideas inbox** (jot down an idea in July) | P2 |
| "Committed" money (planned + ordered) shown separately from "spent" | P1 |
| Recent-activity feed: what your spouse added or bought | P2 |
| Text or email digest: "3 returns close this week" | P3 |
| Receipt photo upload | P3 |
| Price-drop watch on saved links | P3 |
| Extra seasons: birthdays, anniversaries, teacher gifts | P3 (the data model already supports it) |
| Dark mode and a holiday theme | P2 |

## Sources
- Open source: [GiftFlow](https://github.com/garnajee/giftflow), [Christmas Community](https://github.com/Wingysam/Christmas-Community), [Wishlist (ElfHosted docs)](https://docs.elfhosted.com/app/wishlist/), [Pønskelisten](https://selfhostyourself.com/services/poenskelisten), [Geeftlist](https://selfhostyourself.com/services/geeftlist), [selfhostyourself: Giftster alternatives](https://selfhostyourself.com/alternative-to/giftster)
- Spreadsheets: [Spreadsheet Daddy](https://spreadsheetdaddy.com/templates/christmas-shopping-list-spreadsheet), [Financial Aha](https://www.financialaha.com/free-spreadsheet-templates/special-purpose/christmas-budget), [Producing Paradise](https://www.producingparadise.com/workflows/how-to-manage-your-christmas-gift-budget-and-ideas-using-google-sheets), [Etsy tracker](https://www.etsy.com/listing/4593832964), [Payhip](https://payhip.com/b/smz7l), [Getly](https://www.getly.store/product/christmas-gift-budget-gift-list-spreadsheet-xlsx-holiday-shopping-tracker)
- Apps: [Santa's Bag](https://apps.apple.com/us/app/santas-bag/id397698040), [Gifted](https://apps.apple.com/app/gifted/id543667653), [Christmas Gift List Tracker](https://apps.apple.com/app/id1444504033), [The Christmas Gift List Pro](https://apps.apple.com/us/app/id755493890), [GiftList](https://apps.apple.com/us/app/id1440596904), [GiftList blog roundup](https://giftlist.com/blog/best-apps-for-tracking-holiday-wish-lists-2025), [Livingetc roundup](https://livingetc.com/advice/best-Christmas-list-organizing-apps)
- Hosting: [Hostinger: MySQL with Node.js](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/), [Hostinger + Cloudflare DNS](https://support.hostinger.com/en/articles/6865646-how-to-point-a-domain-to-hostinger-website-builder-via-cloudflare), [Hostinger Node.js docs](https://docs.hostinger.com/node.js/github) (not fetched directly; see the note in PLAN.md)
