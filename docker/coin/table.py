# Coin's node field list (from ./fields) on stdin -> the TypeScript table on stdout.
import sys
lines = [l.strip() for l in sys.stdin if l.strip()]
print("""// Made by docker/coin/make.sh from Coin3D's nodes: don't edit.
//
// Binary Inventor files don't say what type a built-in node's fields are (the
// reader is meant to know), so this says, for each Inventor node: its fields
// and their types, one line a node; a + after its name marks a group (its
// children follow its fields).
export const INVENTOR_FIELDS = `""")
for l in sorted(lines):
    print(l)
print("`;")
