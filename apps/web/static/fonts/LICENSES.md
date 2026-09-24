# Fonts shipped with the web app

Each file is byte-identical to the one Excalidraw ships at the commit this project is held to
(`scripts/oracle-sha.txt`, `packages/excalidraw/fonts/<Family>/<file>`), so text measures and
draws as it does there. Only the Latin and Latin Extended shards are shipped; other scripts fall
back through each family's stack (`engine/crates/draw-engine/src/text/font.rs`).

The licence of every file was read from the file itself — the OpenType `name` table, IDs 0
(copyright), 13 (licence) and 14 (licence URL) — with fontTools. A font whose licence cannot be
established that way is not shipped.

| Family (id)      | Files                                                                                                                            | Copyright (name ID 0)                                                                                                     | Licence, as the file states it                                                                                                                           | Full text              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Virgil (1)       | `Virgil/Virgil-Regular.woff2`                                                                                                    | Copyright (c) 2011 by Your Own Font Foundry. All rights reserved.                                                         | ID 13: SIL Open Font License 1.1, full text embedded; ID 14 `http://scripts.sil.org/OFL`                                                                 | `OFL-1.1.txt`          |
| Cascadia (3)     | `Cascadia/CascadiaCode-Regular.woff2`                                                                                            | © 2020 Microsoft Corporation. All Rights Reserved.                                                                        | ID 13: a Microsoft preamble, then "the following license, based on the SIL Open Font license, applies to this font"; ID 14 `https://scripts.sil.org/OFL` | `Cascadia-LICENSE.txt` |
| Nunito (6)       | `Nunito/…dTQ3j6zbXWjgeg.woff2` (Latin), `Nunito/…dTo3j6zbXWjgevT5.woff2` (Latin Ext)                                             | Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)                                         | ID 14 `https://scripts.sil.org/OFL` (no ID 13)                                                                                                           | `OFL-1.1.txt`          |
| Lilita One (7)   | `Lilita/…EF8RXi4EwQ.woff2` (Latin), `Lilita/…E98RXi4EwSsbg.woff2` (Latin Ext)                                                    | Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz), with Reserved Font Names "Lilita One"                            | ID 14 `http://scripts.sil.org/OFL` (no ID 13)                                                                                                            | `OFL-1.1.txt`          |
| Comic Shanns (8) | `ComicShanns/…279a7b317d12eb88de06167bd672b4b4.woff2` (Latin), `ComicShanns/…fcb0fc02dcbee4c9846b3e2508668039.woff2` (Latin Ext) | MIT License; Shannon Miwa 2018, Jesus Gonzalez 2023, Rodrigo Batista de Moraes 2023, Fini Jastrow 2024, Kyle Beechly 2024 | ID 0 carries the whole MIT licence                                                                                                                       | `ComicShanns-MIT.txt`  |

The files are shipped unmodified, under their own names; "Lilita One" is a Reserved Font Name
and is used only for the unmodified font.

## Not shipped

| Family (id)                 | Why                                                                                                                                                                                                                                    | What draws instead                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Excalifont (5)              | Its shards carry only "Copyright (c) 2024 by Excalidraw. All rights reserved." — no ID 13 or 14. The OFL notice exists only in a comment of Excalidraw's `fonts/Excalifont/index.ts`, not in the files, so the rule above excludes it. | `Xiaolai, sans-serif` from its stack |
| Liberation Sans (9)         | ID 13 reads "subject to the license agreement under which you accepted the Liberation font software", which names no licence.                                                                                                          | `sans-serif`                         |
| Helvetica (2)               | A system font in Excalidraw too (`local: true`).                                                                                                                                                                                       | the system's Helvetica / sans-serif  |
| Xiaolai, Segoe UI Emoji     | Out of scope: CJK and emoji fallbacks.                                                                                                                                                                                                 | the system's fallback                |
| Comic Shanns shards 2 and 3 | Arrows, maths symbols and λ — not Latin.                                                                                                                                                                                               | `monospace`                          |
