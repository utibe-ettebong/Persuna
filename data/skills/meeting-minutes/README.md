# Meeting minutes skill

The pairs here train and test the skill. Each pair is two files with the same name:

- `<name>.input.md`: the raw notes
- `<name>.output.md`: your finished minutes

Put 10 pairs in `pairs/train/` and 5 in `pairs/test/`. Moving a file pair between the folders changes the split.

The `sample-*` pairs are invented placeholders that let the pipeline run end to end. Delete them once your own pairs are in. `npm run skill -- import` makes the database match this folder, so deleted pairs are removed there too.

**This repository is public.** Only add invented or fully anonymised meetings: no real names, organisations, phone numbers, account numbers or addresses.
