2. Aufhübschen der Informations- und Schaltflächenpills von Mega1 und Mega2 (Weichen und Blöcke): Ziel ist es hier, dass zum einen bei fehlenden Daten nicht nur "keine Daten verfügbar" erscheint, sondern ausgegraute Schalt- und Infoflächen. Zweitens soll die graphische Darstellung dafür sorgen, dass die Informationen optisch einfacher erfasst werden können. Ich würde dazu gerne die angehängten PNGs verwenden. Es gibt drei Weichenarten: Linksweiche, Rechtsweiche, Kreuzweiche. Jeder Weichentyp verfügt über gerade, Abzweig und undefined. Folgende Liste gibt die Aufstellung der Weichenzuordnung:
W0: Linksweiche, Bild ist um 180° zu drehen
W1: Rechtsweiche, Bild ist um 180° zu drehen
W2: Kreuzweiche, Bildorientierung ok
W3: Kreuzweiche, Bildorientierung ok
W4: Kreuzweiche, Bildorientierung ok
W5: Rechtsweiche, Bildorientierung ok
W6: Linksweiche, Bild ist um 90° im UZS zu drehen
W7: Rechtsweiche, Bildorientierung ok
W8: Linksweiche, Bildorientierung ok
W9: Rechtsweiche, Bildorientierung ok
W10: Rechtsweiche, Bild ist um 180° zu drehen
W11: Rechtsweiche, Bild ist um 180° zu drehen
W12 (SBHF): Linksweiche, Bildorientierung ok
W13 (SBHF): Linksweiche, Bildorientierung ok
W14 (SBHF): Linksweiche, Bild ist um 180° zu drehen
W15 (SBHF): Linksweiche, Bild ist um 180° zu drehen
Für die Blockfreigaben habe ich Signale vorbereitet als Signal rot, Signal grün und Signal aus (für undefined)

Rotation Map
const TURNOUT_UI = {
  0: { type:"L", rot:180 },
  1: { type:"R", rot:180 },
  2: { type:"X", rot:0 },
  3: { type:"X", rot:0 },
  4: { type:"X", rot:0 },
  5: { type:"R", rot:0 },
  6: { type:"L", rot:90 },   // UZS
  7: { type:"R", rot:0 },
  8: { type:"L", rot:0 },
  9: { type:"R", rot:0 },
  10:{ type:"R", rot:180 },
  11:{ type:"R", rot:180 },
  12:{ type:"L", rot:0 },
  13:{ type:"L", rot:0 },
  14:{ type:"L", rot:180 },
  15:{ type:"L", rot:180 },
};
