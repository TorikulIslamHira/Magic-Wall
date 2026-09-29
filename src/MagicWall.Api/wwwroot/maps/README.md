# Map data

| File | Contents | Source | License |
|---|---|---|---|
| `bd-districts.geojson` | 64 districts; properties `code`, `name_en`, `name_bn`, `division`, `division_bn` | geoBoundaries gbOpen BGD ADM2 (Bangladesh Bureau of Statistics, OCHA ROAP) | CC BY 3.0 IGO. **On-air use requires attribution:** "Boundaries: BBS / OCHA via geoBoundaries" |
| `bd-divisions.geojson` | 8 divisions, dissolved from the districts above | as above | as above |
| `world.geojson` | 241 countries; properties `code` (ISO 3166 alpha-3 style, Natural Earth `ADM0_A3`), `name_en`, `name_bn` | Natural Earth 1:50m Admin 0 | Public domain |

**War zone codes:** a conflict zone's "SVG path id" is the country's `code` in `world.geojson`.
These are ISO 3166 alpha-3 for almost every country (`UKR`, `SDN`, `MMR`), with a few Natural
Earth exceptions, e.g. South Sudan `SDS`, Palestine `PSX`, Kosovo `KOS`. For areas smaller than
a country, add features with a `code` property to an optional `war-regions.geojson` here.

District names and codes come from `tools/data/bd-districts.csv`. Regenerate with mapshaper:

```bash
npx mapshaper -i geoBoundaries-BGD-ADM2_simplified.geojson \
  -join tools/data/bd-districts.csv keys=shapeName,source_name string-fields=source_name,code,name_en,name_bn,division,division_bn,seats \
  -filter-fields code,name_en,name_bn,division,division_bn -simplify 12% keep-shapes -clean \
  -o bd-districts.geojson precision=0.0001 \
  -dissolve division copy-fields=division_bn -o bd-divisions.geojson precision=0.0001
```

## Constituency map (300 seats)

When a constituency boundary file is available, save it as `bd-constituencies.geojson`
with a `code` property per feature equal to the constituency's `SvgPathId` (e.g. `dhaka-10`)
and a `district` property equal to its district `code`. The Election view switches to
seat-level automatically when the file exists.

Party colours: `../config/parties.json`.
