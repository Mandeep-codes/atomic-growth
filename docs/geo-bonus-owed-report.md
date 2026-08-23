# Geo CPM bonus — what is owed
**Campaign:** Nyne AI x Atomik Clips (the only campaign with geo rules)
**Window:** last 14 days
**Generated from production data**

## Headline

**No geo bonus has ever been paid — not in this window, not once in the platform's history.**
All 27,692 reward rows ever written carry `geo_bonus_cpm = 0`. The kill-switch
`GEO_PAYOUT_ENABLED = false` makes the resolver return "no bonus" before any rule is read.

Meanwhile the rules were configured on 7 Aug, clippers filed demographics, and moderators
approved 403 of them. The inputs were all in place; only the switch was off.

## What is owed

| | Rows | Amount |
|---|---|---|
| **Firm** — every one of that clipper's accounts on the platform qualifies | 22 | **$198.09** |
| **Needs a decision** — only some of their accounts qualify | 40 | up to $357.41 |
| **Total range** | 62 | **$198.09 – $555.50** |

Base pay over the same window was $7,482.41 on 7,482,405 views, so the bonus adds
roughly 2.6%–7.4% on top.

## Why there is a range, not one number

Every reward row in this window has an empty `verified_user_id` — **3,619 of 3,619**.
Views are recorded per clipper per platform, not per account. That is the odometer cutover
that was never run, and the code comments call it out as the reason the switch must stay off.

The bonus is a **per-account** rate. So when a clipper has two YouTube accounts and only one
of them meets the US threshold, the data cannot say how many of those views came from the
qualifying account. Those 40 rows are listed separately and priced at the
*upper* bound — paying it in full is generous, not exact.

The 22 firm rows have no such problem: every account that clipper runs on
that platform qualifies, so whichever account produced the views, the rate is the same.

## How each clipper was qualified

Applied exactly as the shipped code would, not a rule invented for this report:

1. Take the **latest moderator-approved** demographics report for the account on this campaign. Pending and rejected reports never set a rate.
2. Read the audience country split from that report.
3. A rule qualifies when **every** country in it meets its minimum — `US 20%` needs US ≥ 20%, `US 30%` needs US ≥ 30%.
4. When both qualify, the **higher** bonus wins.
5. Deleted or banned accounts are excluded outright.

| Rule | Requires | Bonus |
|---|---|---|
| US 20% | US ≥ 20% of audience | $0.10 per 1,000 views |
| US 30% | US ≥ 30% of audience | $0.25 per 1,000 views |

This is the two-layer gate: the clipper must have filed demographics **and** a moderator must
have approved them, before the audience split counts for anything.

## Firm — $198.09

| Clipper | Platform | Account(s) | Rule | US % | Views (14d) | Bonus CPM | Owed |
|---|---|---|---|---|---|---|---|
| bunny_y0 | youtube | finhub.clipss | US 20% | 24.1% | 309,971 | $0.10/1k | **$31.00** |
| rohitgrinds | youtube | techx.founders | US 30% | 46.5% | 118,207 | $0.25/1k | **$29.55** |
| raghav_44537 | youtube | rysnclub | US 20% | 29.7% | 168,171 | $0.10/1k | **$16.82** |
| amitkumar.21 | youtube | ThinkBigger222 | US 30% | 30% | 55,186 | $0.25/1k | **$13.80** |
| jensen200 | youtube | Business_Brief_BB | US 30% | 55.4% | 47,588 | $0.25/1k | **$11.90** |
| jayparmar1 | youtube | thefoundersframe1, thecapitalcut1, THEWEALTHWIRE01, FIRSTSIGNAL4 | US 30% | 61.7% | 44,900 | $0.25/1k | **$11.23** |
| naloi0760_43443 | youtube | techledger00, Primemedia000 | US 30% | 45.6% | 39,695 | $0.25/1k | **$9.92** |
| matrix07186 | youtube | OriginAlpha-Pod, NeXora-Podz | US 30% | 42.5% | 37,663 | $0.25/1k | **$9.42** |
| wizard_07x | tiktok | fyppclips077 | US 30% | 33.33% | 36,833 | $0.25/1k | **$9.21** |
| lassann_69 | youtube | Innovaity, innovty8 | US 30% | 41.7% | 34,663 | $0.25/1k | **$8.67** |
| wizard_07x | youtube | vcbackstage | US 30% | 38% | 29,649 | $0.25/1k | **$7.41** |
| adarshjadhavv | youtube | dealflowdigestvc | US 30% | 53.6% | 28,103 | $0.25/1k | **$7.03** |
| wasa_x | youtube | XeniaProject | US 30% | 51.2% | 26,381 | $0.25/1k | **$6.60** |
| suhani1037 | youtube | Moneyverse47 | US 20% | 21.3% | 64,020 | $0.10/1k | **$6.40** |
| jayveer5538 | youtube | vcvaultt | US 20% | 20.6% | 56,325 | $0.10/1k | **$5.63** |
| ronin_012 | youtube | VCinsider | US 20% | 22.8% | 55,955 | $0.10/1k | **$5.60** |
| ash034328 | youtube | FounderNetwork-p9v | US 20% | 27.8% | 31,378 | $0.10/1k | **$3.14** |
| jatinyadavv | youtube | Verse_fintech | US 20% | 21.1% | 24,382 | $0.10/1k | **$2.44** |
| rizwanmondall | tiktok | moneyxvault | US 30% | 93.4% | 5,999 | $0.25/1k | **$1.50** |
| whimsical_wolf_30518 | instagram | foundersminds | US 30% | 55.3% | 3,083 | $0.25/1k | **$0.77** |
| khanayan09 | tiktok | financeedgexx | US 30% | 74.1% | 199 | $0.25/1k | **$0.05** |
| rongavexp | x | moneyfrontier | US 20% | 21% | 11 | $0.10/1k | **$0.00** |

## Needs a decision — up to $357.41

These clippers have more than one account on the platform and only some qualify. Views cannot
be split between them, so each row is priced as if **all** the views came from the qualifying
account.

| Clipper | Platform | Account(s) | Rule | US % | Views (14d) | Bonus CPM | Owed |
|---|---|---|---|---|---|---|---|
| shree_199 | youtube | businesstalk023 | US 30% | 30.6% | 266,604 | $0.25/1k | **$66.65** |
| yuvvv1 | youtube | thefoundersviision | US 30% | 51% | 127,273 | $0.25/1k | **$31.82** |
| ankit_negiii | youtube | startupsonly, foundersonlyyy | US 30% | 41% | 125,411 | $0.25/1k | **$31.35** |
| isoslangy | youtube | TheFounders-Room, TheFounder-Files | US 30% | 32.7% | 83,138 | $0.25/1k | **$20.78** |
| ankur6607 | youtube | founderstoriess, buildinggreatss, allfinanceonair | US 30% | 43% | 70,107 | $0.25/1k | **$17.53** |
| yuvvv1 | instagram | thefoundersviision | US 30% | 44.7% | 68,590 | $0.25/1k | **$17.15** |
| dinosaur999990 | youtube | Fintech037, podcastMotivation-p7h | US 20% | 20.8% | 154,913 | $0.10/1k | **$15.49** |
| imnoob03136 | youtube | AnonymousYT-321 | US 30% | 34.7% | 44,242 | $0.25/1k | **$11.06** |
| yash_1991 | youtube | Growvia-y18n | US 20% | 20.9% | 108,448 | $0.10/1k | **$10.84** |
| zyroxen7 | youtube | techlabs07 | US 20% | 22.3% | 107,476 | $0.10/1k | **$10.75** |
| sameerhassxxn | youtube | fintechdiariesyt, fintechtrends-e4k | US 30% | 33% | 40,256 | $0.25/1k | **$10.06** |
| rshul. | youtube | nocontextneeded-h9t, WorthClips-m1p, growpathglobal | US 30% | 32.3% | 39,666 | $0.25/1k | **$9.92** |
| sagarmohan.singh | youtube | growfund-m | US 20% | 23.2% | 80,505 | $0.10/1k | **$8.05** |
| official_piyush_4 | youtube | entrepreneur_regulary, fintechregularly_05 | US 30% | 47% | 31,772 | $0.25/1k | **$7.94** |
| shubhhss | youtube | businessmindset.s | US 30% | 69% | 28,655 | $0.25/1k | **$7.16** |
| abdulraafay007 | youtube | finsnaps | US 20% | 25.2% | 61,042 | $0.10/1k | **$6.10** |
| gauravkumavatji | youtube | TechWealth-z9s | US 20% | 23.7% | 59,923 | $0.10/1k | **$5.99** |
| pranky5274 | youtube | Money_talks1-r6b, Money_talks22 | US 20% | 22.8% | 59,826 | $0.10/1k | **$5.98** |
| khanayan09 | youtube | decodefounders, scalable_silicon | US 20% | 24% | 59,615 | $0.10/1k | **$5.96** |
| virat02746 | youtube | Startup_blueprint_x.10 | US 20% | 20.6% | 53,649 | $0.10/1k | **$5.36** |
| pranavv1_ | youtube | Founderspovv, wealthX_10 | US 30% | 35.7% | 20,787 | $0.25/1k | **$5.20** |
| berlin_677 | youtube | clipspro_77, clipspulsee7 | US 20% | 27% | 48,856 | $0.10/1k | **$4.89** |
| kunalsahrma | youtube | thecapitalclub-e7l | US 20% | 26.4% | 43,621 | $0.10/1k | **$4.36** |
| shubhaaaa_ | youtube | technova090 | US 20% | 25.2% | 43,006 | $0.10/1k | **$4.30** |
| akhil00878 | youtube | alpharelicsYT | US 20% | 21.2% | 41,247 | $0.10/1k | **$4.12** |
| ayush27z | youtube | Dcompound | US 20% | 26.4% | 41,120 | $0.10/1k | **$4.11** |
| xharsh2563 | youtube | TechAIMoneyy, clip.ixy1 | US 20% | 29.7% | 34,284 | $0.10/1k | **$3.43** |
| prodzii__58020 | youtube | wallstreethype | US 20% | 26.8% | 30,815 | $0.10/1k | **$3.08** |
| rongavexp | youtube | moneyfrontierhub | US 20% | 21% | 27,272 | $0.10/1k | **$2.73** |
| not._.ysh | youtube | ScaleXhq | US 20% | 20.2% | 27,283 | $0.10/1k | **$2.73** |
| akira050432 | youtube | TCOMILLONAIRE | US 20% | 22.8% | 26,690 | $0.10/1k | **$2.67** |
| iamkaif555 | youtube | Valuesignalss | US 20% | 23.9% | 20,398 | $0.10/1k | **$2.04** |
| light_yagami_08 | youtube | poddigestofficial | US 20% | 20.9% | 19,279 | $0.10/1k | **$1.93** |
| chetan3395 | instagram | fintechpulsehq | US 30% | 44% | 6,689 | $0.25/1k | **$1.67** |
| sanket0582 | youtube | Leverage-b4h | US 20% | 29.4% | 16,601 | $0.10/1k | **$1.66** |
| chetan3395 | tiktok | fintechpulsehq | US 30% | 37.4% | 4,025 | $0.25/1k | **$1.01** |
| light_yagami_08 | instagram | thecapitalclipz | US 20% | 24.9% | 9,813 | $0.10/1k | **$0.98** |
| light_yagami_08 | tiktok | thecapitalclipz | US 30% | 92.4% | 2,214 | $0.25/1k | **$0.55** |
| mohitsharma_1969 | youtube | founderspodofficial | US 20% | 26.2% | 91 | $0.10/1k | **$0.01** |
| vinayak0362 | youtube | buildthesis | US 20% | 24% | 10 | $0.10/1k | **$0.00** |

## Before paying

- **Decide the ambiguous rows.** Pay the upper bound, pay nothing, or hold them until views can be attributed per account.
- **Run the odometer cutover before switching the feature on.** Until it runs, new views stay unattributed and the same ambiguity repeats every week.
- **This is a back-payment, not a switch.** Turning `GEO_PAYOUT_ENABLED` on pays *future* views only; nothing here is paid retroactively by flipping it.
- **Only Nyne AI is affected.** No other campaign has geo rules, so no other campaign owes anything.
