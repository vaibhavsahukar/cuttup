#!/bin/sh
# Re-measure every reference model into src/data/shapes (references live outside the repo).
# Usage: sh scripts/extract-all.sh <referenceDir>
S=${1:-/tmp/claude-0/src}
while read id len flip bike; do
  npx tsx scripts/extract-shape.ts "$S/$id.glb" "$id" "$len" "$flip" "$bike" | sed 's/| wheels [0-9] \[.*\] |/|/'
done <<LIST
zr1 4.46 0 0
m4 4.8 0 0
huracan 4.46 0 0
c63 4.75 0 0
civic 4.6 0 0
tesla 4.69 1 0
cbr650 2.13 1 1
t_sedan 4.6 0 0
t_pickup 5.9 0 0
t_hatch 4.46 0 0
t_lexus 5.1 0 0
t_crv 4.7 1 0
t_boxtruck 7.4 0 0
t_van 5.0 0 0
cop_basic 5.0 0 0
cop_charger 5.1 0 0
LIST
