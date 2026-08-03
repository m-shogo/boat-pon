# Archive refund semantics v1/v2 diff

- generated: 2026-08-03T01:26:02.141Z
- scope: read-only v1/v2 parse of immutable K archives; no DB/archive mutation
- files: 8174/8174
- changed files: 5261
- parse errors: 0
- legacy refund candidates: 319309
- current refund candidates: 1558
- refund candidate reduction: 317751
- special payout candidates added: 65157
- false refunds reclassified: 317753
- other changes: 2

| year | bet type | special added | false refund reclassified | other change |
|---:|---|---:|---:|---:|
| 2000 | exacta | 0 | 351 | 0 |
| 2000 | place | 225 | 336 | 0 |
| 2000 | quinella | 0 | 279 | 0 |
| 2000 | win | 415 | 0 | 0 |
| 2004 | exacta | 0 | 4702 | 0 |
| 2004 | place | 2219 | 1463 | 0 |
| 2004 | quinella | 0 | 4702 | 0 |
| 2004 | trifecta | 0 | 4728 | 0 |
| 2004 | trio | 1 | 4727 | 0 |
| 2004 | wide | 45 | 4598 | 0 |
| 2004 | win | 3080 | 0 | 0 |
| 2005 | exacta | 0 | 7987 | 0 |
| 2005 | place | 3744 | 2690 | 0 |
| 2005 | quinella | 1 | 7987 | 0 |
| 2005 | trifecta | 0 | 7995 | 0 |
| 2005 | trio | 2 | 7994 | 0 |
| 2005 | wide | 27 | 7857 | 0 |
| 2005 | win | 5309 | 0 | 0 |
| 2006 | exacta | 0 | 8076 | 0 |
| 2006 | place | 3601 | 2967 | 0 |
| 2006 | quinella | 0 | 8076 | 0 |
| 2006 | trifecta | 0 | 8072 | 0 |
| 2006 | trio | 2 | 8072 | 0 |
| 2006 | wide | 6 | 7959 | 0 |
| 2006 | win | 5518 | 0 | 0 |
| 2007 | exacta | 0 | 6714 | 0 |
| 2007 | place | 2897 | 2824 | 0 |
| 2007 | quinella | 3 | 6711 | 0 |
| 2007 | trifecta | 0 | 6709 | 0 |
| 2007 | trio | 0 | 6709 | 0 |
| 2007 | wide | 14 | 6678 | 0 |
| 2007 | win | 4599 | 0 | 0 |
| 2008 | exacta | 0 | 5669 | 0 |
| 2008 | place | 2513 | 2429 | 0 |
| 2008 | quinella | 0 | 5669 | 0 |
| 2008 | trifecta | 0 | 5668 | 0 |
| 2008 | trio | 0 | 5667 | 0 |
| 2008 | wide | 4 | 5662 | 0 |
| 2008 | win | 3862 | 0 | 0 |
| 2009 | exacta | 0 | 5264 | 0 |
| 2009 | place | 2239 | 2578 | 0 |
| 2009 | quinella | 2 | 5263 | 0 |
| 2009 | trifecta | 0 | 5258 | 0 |
| 2009 | trio | 2 | 5256 | 0 |
| 2009 | wide | 3 | 5255 | 0 |
| 2009 | win | 3708 | 1 | 0 |
| 2010 | exacta | 1 | 4785 | 0 |
| 2010 | place | 1860 | 2637 | 0 |
| 2010 | quinella | 2 | 4784 | 0 |
| 2010 | trifecta | 0 | 4778 | 0 |
| 2010 | trio | 1 | 4777 | 0 |
| 2010 | wide | 2 | 4779 | 0 |
| 2010 | win | 3482 | 1 | 0 |
| 2011 | exacta | 0 | 3743 | 0 |
| 2011 | place | 1163 | 2441 | 0 |
| 2011 | quinella | 4 | 3743 | 0 |
| 2011 | trifecta | 0 | 3741 | 0 |
| 2011 | trio | 0 | 3741 | 0 |
| 2011 | wide | 0 | 3742 | 0 |
| 2011 | win | 2931 | 0 | 0 |
| 2012 | exacta | 0 | 3215 | 0 |
| 2012 | place | 878 | 2265 | 0 |
| 2012 | quinella | 4 | 3212 | 0 |
| 2012 | trifecta | 0 | 3211 | 0 |
| 2012 | trio | 0 | 3211 | 0 |
| 2012 | wide | 1 | 3212 | 0 |
| 2012 | win | 2603 | 0 | 0 |
| 2013 | exacta | 0 | 2755 | 0 |
| 2013 | place | 757 | 1939 | 0 |
| 2013 | quinella | 4 | 2753 | 0 |
| 2013 | trifecta | 0 | 2756 | 0 |
| 2013 | trio | 1 | 2756 | 0 |
| 2013 | wide | 0 | 2756 | 0 |
| 2013 | win | 2226 | 0 | 0 |
| 2014 | exacta | 0 | 1855 | 0 |
| 2014 | place | 497 | 1350 | 0 |
| 2014 | quinella | 3 | 1854 | 0 |
| 2014 | trifecta | 0 | 1854 | 0 |
| 2014 | trio | 2 | 1853 | 0 |
| 2014 | wide | 0 | 1854 | 0 |
| 2014 | win | 1483 | 0 | 2 |
| 2015 | exacta | 1 | 1210 | 0 |
| 2015 | place | 299 | 910 | 0 |
| 2015 | quinella | 5 | 1209 | 0 |
| 2015 | trifecta | 0 | 1212 | 0 |
| 2015 | trio | 0 | 1212 | 0 |
| 2015 | wide | 1 | 1211 | 0 |
| 2015 | win | 978 | 0 | 0 |
| 2016 | exacta | 0 | 773 | 0 |
| 2016 | place | 167 | 606 | 0 |
| 2016 | quinella | 3 | 772 | 0 |
| 2016 | trifecta | 0 | 773 | 0 |
| 2016 | trio | 1 | 773 | 0 |
| 2016 | wide | 0 | 773 | 0 |
| 2016 | win | 637 | 0 | 0 |
| 2017 | exacta | 0 | 391 | 0 |
| 2017 | place | 54 | 338 | 0 |
| 2017 | quinella | 7 | 386 | 0 |
| 2017 | trifecta | 0 | 390 | 0 |
| 2017 | trio | 0 | 390 | 0 |
| 2017 | wide | 0 | 391 | 0 |
| 2017 | win | 352 | 0 | 0 |
| 2018 | exacta | 0 | 224 | 0 |
| 2018 | place | 22 | 202 | 0 |
| 2018 | quinella | 1 | 224 | 0 |
| 2018 | trifecta | 0 | 222 | 0 |
| 2018 | trio | 0 | 222 | 0 |
| 2018 | wide | 0 | 222 | 0 |
| 2018 | win | 209 | 0 | 0 |
| 2019 | exacta | 0 | 180 | 0 |
| 2019 | place | 10 | 170 | 0 |
| 2019 | quinella | 1 | 180 | 0 |
| 2019 | trifecta | 0 | 180 | 0 |
| 2019 | trio | 0 | 180 | 0 |
| 2019 | wide | 0 | 180 | 0 |
| 2019 | win | 170 | 0 | 0 |
| 2020 | exacta | 0 | 74 | 0 |
| 2020 | place | 4 | 70 | 0 |
| 2020 | quinella | 2 | 74 | 0 |
| 2020 | trifecta | 0 | 75 | 0 |
| 2020 | trio | 0 | 75 | 0 |
| 2020 | wide | 0 | 75 | 0 |
| 2020 | win | 70 | 0 | 0 |
| 2021 | exacta | 0 | 54 | 0 |
| 2021 | place | 1 | 53 | 0 |
| 2021 | quinella | 1 | 54 | 0 |
| 2021 | trifecta | 0 | 55 | 0 |
| 2021 | trio | 0 | 55 | 0 |
| 2021 | wide | 0 | 55 | 0 |
| 2021 | win | 53 | 0 | 0 |
| 2022 | exacta | 0 | 33 | 0 |
| 2022 | place | 1 | 32 | 0 |
| 2022 | quinella | 3 | 33 | 0 |
| 2022 | trifecta | 0 | 36 | 0 |
| 2022 | trio | 0 | 36 | 0 |
| 2022 | wide | 0 | 36 | 0 |
| 2022 | win | 32 | 0 | 0 |
| 2023 | exacta | 0 | 39 | 0 |
| 2023 | place | 1 | 38 | 0 |
| 2023 | quinella | 0 | 39 | 0 |
| 2023 | trifecta | 0 | 39 | 0 |
| 2023 | trio | 0 | 39 | 0 |
| 2023 | wide | 0 | 39 | 0 |
| 2023 | win | 38 | 0 | 0 |
| 2024 | exacta | 1 | 37 | 0 |
| 2024 | place | 2 | 35 | 0 |
| 2024 | quinella | 4 | 36 | 0 |
| 2024 | trifecta | 0 | 40 | 0 |
| 2024 | trio | 0 | 40 | 0 |
| 2024 | wide | 0 | 40 | 0 |
| 2024 | win | 35 | 0 | 0 |
| 2025 | exacta | 0 | 22 | 0 |
| 2025 | place | 0 | 22 | 0 |
| 2025 | quinella | 4 | 22 | 0 |
| 2025 | trifecta | 0 | 26 | 0 |
| 2025 | trio | 0 | 26 | 0 |
| 2025 | wide | 0 | 26 | 0 |
| 2025 | win | 22 | 0 | 0 |
| 2026 | exacta | 1 | 18 | 0 |
| 2026 | place | 0 | 18 | 0 |
| 2026 | quinella | 0 | 19 | 0 |
| 2026 | trifecta | 0 | 19 | 0 |
| 2026 | trio | 0 | 19 | 0 |
| 2026 | wide | 0 | 19 | 0 |
| 2026 | win | 18 | 0 | 0 |

> The N2 profile reference (excluded_refunded=319,301) is canonical candidate-level. Do not assert exact reconciliation until source-duplicate resolution is applied to these raw-scan totals.
