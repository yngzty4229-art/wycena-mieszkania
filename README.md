# Wycena z aktów

Bezpłatna wycena mieszkania w Polsce na podstawie **prawdziwych cen z aktów notarialnych** w okolicy,
a nie cen z ogłoszeń. Działa w przeglądarce telefonu i komputera, można ją dodać do ekranu głównego jak aplikację.

**Aplikacja:** https://yngzty4229-art.github.io/wycena-mieszkania/

## Skąd są dane
- Ceny: Rejestr Cen Nieruchomości (RCN) – otwarte dane GUGiK z aktów notarialnych zbieranych przez starostwa.
  Akty sprzedaży mieszkań z ostatnich 3 lat, odświeżane co tydzień (folder `dane/`).
- Adresy: usługa wyszukiwania adresów UUG GUGiK, awaryjnie OpenStreetMap Nominatim (© autorzy OpenStreetMap).

## Jak liczymy
Sprzedaże z ostatnich 24 miesięcy w promieniu 1 km (gdy podobnych jest za mało: 2,5 km, potem 6 km), ceny
przeliczone na dziś według zmian cen w okolicy, wagi podobieństwa (odległość, metraż, pokoje, piętro, świeżość),
ważona mediana ceny za m². Wycena liczy się w przeglądarce – adresu nie zapisujemy.

To szacunek automatyczny, a nie operat szacunkowy rzeczoznawcy.
