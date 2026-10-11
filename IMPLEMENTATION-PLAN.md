# Plan: minimaler und stabiler Companion-Betrieb

Stand: 2026-10-11

## Zielbild

Das Modul verwaltet ausschließlich Preset 1 / Bank 1. Beim Verbinden stellt es diesen Modus gezielt her, prüft die 16 internen Steuerfunktionsbytes von Preset 1 und initialisiert seinen Farb-Cache aus Bank 1. Im normalen Betrieb benötigt eine tatsächliche Farbänderung genau einen serialisierten RGB-Schreibbefehl.

## Verbindungsablauf

1. MIDI-Ports öffnen und Discovery senden.
2. Region 4 einmal lesen und validieren.
3. Nur bei Bedarf Preset 1 und Bank 1 einzeln setzen; jede Konfigurationsänderung sichern und vollständig zurücklesen.
4. Nur die 16 Steuerfunktionsbytes von Preset 1 lesen.
5. Nulltabelle akzeptieren. Die exakt bekannte alte Fehlertabelle automatisch auf null setzen, sichern und zurücklesen. Unbekannte Werte nicht verändern und RGB in einen klar protokollierten Degraded-Zustand versetzen.
6. Die 672 Bytes von Preset 1 / Bank 1 einmal lesen und daraus die 16 vorhandenen RGB-Werte übernehmen.
7. In Ready wechseln und die von Companion gewünschten Farben abgleichen.

## Laufender Farbbetrieb

- Deduplizieren und pro Pad nur den neuesten Wunsch behalten.
- Alle Writes über genau einen Worker serialisieren.
- Pro Änderung nur die drei RGB-Bytes schreiben.
- Kein Metadaten-, Flag- oder RGB-Readback pro Farbe.
- Ein konfigurierbares RGB-Intervall von 1–1000 ms verwenden. Standard und Minimum sind nach dem Hardware-Bursttest 1 ms; 0 ms verlor Write 13.
- Ein synchroner Sendefehler beendet die Sitzung. Beim Reconnect wird der echte Farbstand neu gelesen; ungewisse Writes werden nicht blind wiederholt.

## Betrieb und Diagnose

- Explizite Zustände und stabile Logcodes für Supportfälle.
- Session-ID, Ports und Zustandswechsel loggen; keine Zugangsdaten oder Companion-Datenbankinhalte.
- Routinemäßig keine vollständigen Gerätedumps schreiben.
- Sicherungen nur unmittelbar vor einer tatsächlichen Konfigurationsreparatur.
- Ein lokales Diagnosewerkzeug sammelt gefilterte STARRYPAD-Logs und harmlose System-/MIDI-Informationen.

## Tests

- Unit- und Fake-MIDI-Tests für Protokoll, Mapping, Queue, exakte Requestfolge, Auto-Reparatur, unbekannte Flags, Fehler und Close-Rennen.
- Echtes Gerät: minimaler Connect, einzelner RGB-Write, Deduplizierung, alle 16 Pads, Companion-Neustart, mehrfacher Service-Reconnect, Portverlust soweit ohne physischen Eingriff möglich, Logprüfung und Geschwindigkeit.
- Danach gezielte Code- und Bug-Suche einschließlich verspäteter Antworten, Abbruch während Init, Writefehler und Datenschutz im Diagnosepaket.

## Umsetzungsstand

Die Architektur ist implementiert. Der normale RGB-Pfad enthält genau einen Write, die automatische Verwaltung ist auf Preset 1 / Bank 1 begrenzt, Routinedumps wurden entfernt, strukturierte Logs und ein Diagnosewerkzeug sind vorhanden. 24 automatisierte Tests, ein einzelner Hardware-Write, fünf erfolgreiche 16-Pad-Bursts bei 1 ms, zehn zustandsbasiert ausgewertete Companion-Neustarts sowie Abziehen und erneutes Anstecken sind bestanden. Die Surface-ID bleibt bei wechselnden ALSA-Portnummern stabil. Ein 0-ms-Burst erwies sich nicht als Betriebswert geeignet und wird abgewiesen.
