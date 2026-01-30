# WebUI Bild-Assets (skalierte PNGs)

Enthält skalierte/umbenannte Icons für Weichen und Signale.

## Dateien / Naming

Weichen:
- turnout_L_G.png / turnout_L_A.png / turnout_L_U.png   (Linksweiche)
- turnout_R_G.png / turnout_R_A.png / turnout_R_U.png   (Rechtsweiche)
- turnout_X_G.png / turnout_X_A.png / turnout_X_U.png   (Kreuzweiche)

Signale:
- sig_G.png / sig_R.png / sig_U.png

## Zielpfad im ESP WebUI Projekt

Kopiere den Ordner `data/img/` nach:
`<ESP repo>/data/img/`

Dann `pio run -t uploadfs`.

## Rotation pro Weiche (aus WEICHEN_UND_SIGNAL-BESCHREIBUNG.md)

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

## Empfohlene Anzeigegrößen (CSS)

Weiche: 40..56px
Signal: 18..28px

