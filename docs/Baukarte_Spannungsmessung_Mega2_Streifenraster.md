# Baukarte (zum Ausdrucken) -- Spannungsmessung Mega2 auf Streifenraster (kompakt 12×32)

## Koordinatensystem

-   **Sx** = Streifen (1 oben, nach unten steigend)
-   **Ly** = Loch (1 links, nach rechts steigend)
-   Kupferstreifen laufen **horizontal**.

## Streifen-Funktionen

S1=+5V, S2=BIAS, S3=ADC1_NODE(A9), S4=ADC2_NODE(A10), S5=GND_STAR,
S6=GND_MESS (nur links), S7=A1, S8=A2

## Cuts (Kupfer trennen)

-   CUT: S6@L18
-   CUT: S7@L18
-   CUT: S8@L18
-   CUT: S7@L6 *(trennt AC1 von A1)*
-   CUT: S8@L14 *(trennt AC2 von A2)*

## Klemmen / Header

-   K1 (5mm, Kanal1): AC1 = S7@L3, GND_MESS = S6@L5 (L4 frei)
-   K2 (5mm, Kanal2): AC2 = S8@L11, GND_MESS = S6@L13 (L12 frei)
-   J_Mega (1×4): +5V=S1@L31, GND=S5@L31, A9=S3@L31, A10=S4@L31

## Einzige Masseverbindung (Stern!)

-   Drahtbrücke: S6@L14 → S5@L14

------------------------------------------------------------------------

# Bauteil-Koordinatenliste

## Versorgung

  Bauteil     Von      Nach     Hinweis
  ----------- -------- -------- ---------------
  C5V_100nF   S1@L29   S5@L29   Keramik
  C5V_10µF    S1@L28   S5@L28   Elko: + an S1

## Bias (2.5V)

  Bauteil       Von      Nach     Hinweis
  ------------- -------- -------- ---------------
  Rb1 47k       S1@L22   S2@L22   Metallfilm
  Rb2 47k       S2@L24   S5@L24   Metallfilm
  Cbias 100nF   S2@L25   S5@L25   Keramik
  Cbias 22µF    S2@L26   S5@L26   Elko: + an S2

## Kanal 1 (AC1 → A9)

  Bauteil          Von      Nach     Hinweis
  ---------------- -------- -------- ----------------------
  R1_1 180k        S7@L3    S7@L7    benötigt CUT S7@L6
  R2_1 10k         S7@L9    S6@L9    Teiler nach GND_MESS
  Cdiv1 2.2nF      S7@L10   S6@L10   C0G/NP0
  Ccouple1 1µF     S7@L12   S2@L12   Folie
  Rser1 10k        S2@L20   S3@L20   Serie zum ADC
  Cadc1 47nF       S3@L21   S5@L21   Keramik X7R
  D+1 (Schottky)   S3@L22   S1@L22   Anode=S3, Kathode=S1
  D-1 (Schottky)   S5@L23   S3@L23   Anode=S5, Kathode=S3

## Kanal 2 (AC2 → A10)

  Bauteil          Von      Nach     Hinweis
  ---------------- -------- -------- ----------------------
  R1_2 180k        S8@L11   S8@L15   benötigt CUT S8@L14
  R2_2 10k         S8@L16   S6@L16   Teiler nach GND_MESS
  Cdiv2 2.2nF      S8@L17   S6@L17   C0G/NP0
  Ccouple2 1µF     S8@L15   S2@L15   Folie
  Rser2 10k        S2@L19   S4@L19   Serie zum ADC
  Cadc2 47nF       S4@L20   S5@L20   Keramik X7R
  D+2 (Schottky)   S4@L24   S1@L24   Anode=S4, Kathode=S1
  D-2 (Schottky)   S5@L25   S4@L25   Anode=S5, Kathode=S4

------------------------------------------------------------------------

## Mini-Check vor Trafo

1)  +5V an: S1 gegen S5 ≈ 5.0V\
2)  Bias: S2 gegen S5 ≈ 2.5V\
3)  ADC-Knoten: S3 gegen S5 ≈ 2.5V und S4 gegen S5 ≈ 2.5V
