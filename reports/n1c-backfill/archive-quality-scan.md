# N1-C archive data-quality deep scan

- files: 8170 / median decompressed: 169136B / total races: 1194353

| finding | class | count |
|---|---|---:|
| duplicate day sections | CONFIRMED | 4 |
| parse errors | EXPECTED | 0 |
| zero-race files | SUSPECTED | 3 |
| invalid venue | EXPECTED | 0 |
| invalid raceNo | EXPECTED | 0 |
| oversized decompressed | UNKNOWN | 156 |
| undersized decompressed | UNKNOWN | 35 |

- duplicate day sections（CONFIRMED, resolved）: k080706.lzh, k080713.lzh, k090406.lzh, k090708.lzh
- oversized files（要確認、重複由来の可能性）: k040805.lzh, k040813.lzh, k040814.lzh, k040815.lzh, k041022.lzh, k041023.lzh, k041024.lzh, k041105.lzh, k041106.lzh, k041204.lzh
