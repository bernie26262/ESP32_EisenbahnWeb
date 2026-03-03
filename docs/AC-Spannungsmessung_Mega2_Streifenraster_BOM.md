# Spannungsmessung Mega2 -- Streifenraster Aufbau (100x200mm, 2.54mm Raster)

## Besonderheit Schraubklemmen

Verwendete Schraubklemmen: 5,0 mm Rastermaß\
→ Das entspricht **2 Lochabständen (2x 2,54 mm)**\
→ Zwischen zwei Pins einer Klemme bleibt immer **ein Loch frei**

Beispiel: Loch 1 = Pin\
Loch 2 = frei\
Loch 3 = Pin

------------------------------------------------------------------------

# 1. Streifenbelegung

Horizontale Kupferstreifen werden wie folgt genutzt:

  Streifen   Funktion
  ---------- -----------------------------------------------------
  1          +5V
  2          BIAS (2,5V)
  3          ADC1_NODE
  4          ADC2_NODE
  5          GND_STAR
  6          GND_MESS (nur links, später mit GND_STAR verbunden)
  7          A1 (Teiler Kanal 1)
  8          A2 (Teiler Kanal 2)

------------------------------------------------------------------------

# 2. Trennstellen (Kupfer unterbrechen)

Mit 3 mm Bohrer oder Cutter:

-   Streifen 6 bei Loch 40
-   Streifen 7 bei Loch 40
-   Streifen 8 bei Loch 40

------------------------------------------------------------------------

# 3. Schraubklemmen Platzierung (links)

## Klemme 1 -- Kanal 1

Streifen 7 Loch 3 = AC1\
Streifen 6 Loch 3 = GND_MESS

(Loch 4 bleibt frei wegen 5mm Raster)

## Klemme 2 -- Kanal 2

Streifen 8 Loch 10 = AC2\
Streifen 6 Loch 10 = GND_MESS

------------------------------------------------------------------------

# 4. Stern-GND

Streifen 5 komplett durchgehend.

Ein Draht von Streifen 6 Loch 20 → Streifen 5 Loch 20\
(Das ist die einzige Verbindung GND_MESS → GND_STAR)

------------------------------------------------------------------------

# 5. Bias (Mitte, Loch 45--55)

47k von Streifen 1 → Streifen 2\
47k von Streifen 2 → Streifen 5\
22µF Elko von Streifen 2 → Streifen 5 (Plus an Streifen 2)\
100nF von Streifen 2 → Streifen 5

------------------------------------------------------------------------

# 6. Kanal 1 Aufbau

180k von Streifen 7 → AC1\
10k von Streifen 7 → Streifen 6\
2.2nF von Streifen 7 → Streifen 6\
1µF von Streifen 7 → Streifen 2

10k von Streifen 2 → Streifen 3\
47nF von Streifen 3 → Streifen 5\
Schottky von Streifen 3 → Streifen 1\
Schottky von Streifen 5 → Streifen 3\
Ausgang von Streifen 3 → A9

------------------------------------------------------------------------

# 7. Kanal 2 Aufbau

180k von Streifen 8 → AC2\
10k von Streifen 8 → Streifen 6\
2.2nF von Streifen 8 → Streifen 6\
1µF von Streifen 8 → Streifen 2

10k von Streifen 2 → Streifen 4\
47nF von Streifen 4 → Streifen 5\
2x Schottky wie oben\
Ausgang von Streifen 4 → A10

------------------------------------------------------------------------

# 8. Versorgung

100nF von Streifen 1 → Streifen 5\
10µF von Streifen 1 → Streifen 5

+5V vom Netzteil → Streifen 1\
GND vom Netzteil → Streifen 5

Von dort weiter zum Mega.

------------------------------------------------------------------------

# 9. Stückliste (BOM)

## Widerstände (0,25W, THT)

  Menge   Wert    Typ
  ------- ------- -------------------
  2       180kΩ   Metallfilm 1%                   Bestellt
  2       10kΩ    Metallfilm                      bestellt
  2       10kΩ    Metallfilm (Rser)               bestellt
  2       47kΩ    Metallfilm                      

## Kondensatoren

  Menge   Wert    Typ
  ------- ------- -----------------
  2       2.2nF   Keramik C0G                     zu prüfen: Aufdruck 222, bestellt
  2       1µF     Folie (MKT/MKS)                 bestellt
  2       47nF    Keramik X7R                     zu prüfen: Aufdruck 473, bestellt
  1       22µF    Elko ≥10V                       bestellt
  2       100nF   Keramik                         vorhanden: Aufdruck 104
  1       10µF    Elko ≥10V                       bestellt

## Dioden

  Menge   Typ
  ------- -----------------
  4       1N5819 Schottky                         bestellt

## Mechanik

  Menge   Bauteil
  ------- ----------------------------------------
  1       Streifenraster 100x200mm                vorhanden
  2       Schraubklemme 2-polig 5mm Raster        vorhanden
  1       Stiftleiste 4-polig (5V, GND, A9, A10)  vorhanden
  etwas   Schaltdraht                             vorhanden

------------------------------------------------------------------------

# 10. Prüfen vor Einbau

1.  Nur 5V anschließen → Bias messen (\~2,5V)
2.  Keine Verbindung AC testen → ADC sollte \~2,5V anzeigen
3.  Danach Trafo anschließen
