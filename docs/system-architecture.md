# System Architecture – Elektrische Eisenbahn

Diese Datei beschreibt die Architektur der Anlagensteuerung.

Die Anlage besteht aus drei zentralen Mikrocontroller-Systemen:

- ESP32-S3-ETH (Zentrale / Webserver / UI)
- Arduino Mega2560 – Mega1 (Bahnhof / Weichen)
- Arduino Mega2560 – Mega2 (Schattenbahnhof / Blocksteuerung / Safety)

---

# Gesamtübersicht

              Web Browser
                   │
                   │  WebSocket
                   │
           ┌────────────────────┐
           │  ESP32-S3-ETH      │
           │  (Zentrale)        │
           │                    │
           │  Webserver         │
           │  Systemstatus      │
           │  UI / Diagnose     │
           └─────────┬──────────┘
                     │
                     │ I²C
                     │
        ┌────────────┴────────────┐
        │                         │
 ┌───────────────┐        ┌────────────────┐
 │ Mega1         │        │ Mega2          │
 │ Bahnhof       │        │ Schattenbahnhof│
 │               │        │                │
 │ Weichen       │        │ Blocksteuerung │
 │ Rückmelder    │        │ Stromsensoren  │
 │ Selbsttest    │        │ Safety-System  │
 └───────────────┘        └────────────────┘
Aufgaben der einzelnen Systeme
ESP32-S3-ETH

Zentrale Steuerung und Benutzeroberfläche.

Hauptfunktionen:

Webserver

WebSocket-Kommunikation

UI Rendering

Diagnoseoberfläche

Systemstatus-Verteilung

Wichtige Dateien:

src/webserver.cpp
data/index.htm
data/diag.htm
data/script.js
include/proto_common.h

Der ESP sammelt Statusdaten von Mega1 und Mega2 und verteilt sie an die Web-UI.

Mega1 – Bahnhof

Aufgaben:

Steuerung der Weichen

Auswertung der Weichenrückmelder

Selbsttest der Weichen

Relaissteuerung

Wichtige Komponenten:

Weiche.cpp
WeichenController
SensorKontakt

Der Selbsttest prüft beim Start:

Relaisfunktion

Rückmelder

Weichenstellung

Mega2 – Schattenbahnhof und Safety

Mega2 übernimmt mehrere kritische Funktionen:

Blocksteuerung

Verwaltung der Streckenblöcke

Belegt-Erkennung

Einfahrlogik

Blockbelegung basiert auf:

besetzt = Kontakt OR Strom
Strommessung

Jeder Block besitzt einen Stromsensor.

Typische Werte:

Zustand	Strom
Block frei	~0–6 mA
Lok fährt	~80–170 mA

Die Belegungserkennung verwendet:

RMS-Strommessung

Hysterese

Kontaktzustände

Spannungsmessung

Mega2 misst zusätzlich die Trafospannungen:

Trafo oben

Trafo unten

Messverfahren:

1000 Hz Sampling

RMS-Fenster

Bias-Tracking

Safety-System

Mega2 enthält das zentrale Safety-System.

Es überwacht:

Kurzschluss

Not-Aus

Systemfehler

Bei Fehler:

Abschalten der SSR

Blockierung der Anlage

Kommunikation
I²C

Kommunikation zwischen ESP und Megas.

Datentypen:

SystemStatus
BlockStatus
ShadowYardStatus
Mega2SafetyStatus

Die Strukturen sind definiert in:

proto_common.h
WebSocket

ESP sendet Statusdaten an die Weboberfläche.

Typische Nachrichten:

state
diag
analog

Die UI aktualisiert:

Blockbelegung

Weichenstellung

Spannungen

Ströme

Blockbelegung

Ein Block gilt als besetzt, wenn:

kontaktAktiv OR stromAktiv

Strombelegung verwendet Hysterese:

Zustand	Schwelle
SET	≥ 40 mA
CLEAR	≤ 15 mA

Zusätzlich wird eine stabile Freigabe verwendet:

STABLE_FREE_MS = 2500
Diagnose

Die Anlage besitzt zwei Diagnoseebenen:

index.htm

Normale Betriebsansicht.

Zeigt:

Blockzustände

Weichen

Systemstatus

diag.htm

Technische Diagnose.

Zeigt:

Rohsensorwerte

Strom

Spannungen

Debugdaten

Repository-Struktur

Die Firmware ist auf drei Repositories verteilt.

ESP
Mega1
Mega2

Jedes Repository enthält:

src/
include/
docs/
Baseline 2026-03-14

Diese Architektur beschreibt den Systemzustand der Baseline:

anlage-baseline-2026-03-14

Merkmale:

stabile Spannungsmessung

funktionierende Strommessung

optimierter Weichenselbsttest

Protokollintegration abgeschlossen

Diese Baseline dient als Referenz für zukünftige Entwicklungen.

Geplante Erweiterungen

Servo-Steuerung der Trafos

Erweiterte Blockdiagnose

bessere UI-Darstellung der Analogwerte

automatische Stromanalyse