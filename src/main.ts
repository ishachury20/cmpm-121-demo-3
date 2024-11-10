// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";

// Style sheets
import "leaflet/dist/leaflet.css";
import "./style.css";

// Fix missing marker images
import "./leafletWorkaround.ts";

// Deterministic random number generator
import luck from "./luck.ts";

const app: HTMLDivElement = document.querySelector("#app")!;
const gameName = "Geocoin Carrier";
document.title = gameName;
const header = document.createElement("h1");
header.innerHTML = gameName;
app.prepend(header);

// Location of our classroom (as identified on Google Maps)
const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);

// Tunable gameplay parameters
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;

// Create the map (element with id "map" is defined in index.html)
const map = leaflet.map(document.getElementById("map")!, {
  center: OAKES_CLASSROOM,
  zoom: GAMEPLAY_ZOOM_LEVEL,
  minZoom: GAMEPLAY_ZOOM_LEVEL,
  maxZoom: GAMEPLAY_ZOOM_LEVEL,
  zoomControl: false,
  scrollWheelZoom: false,
});

// Populate the map with a background tile layer
leaflet
  .tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })
  .addTo(map);

// Add a marker to represent the player
const playerMarker = leaflet.marker(OAKES_CLASSROOM);
playerMarker.bindTooltip("That's you!");
playerMarker.addTo(map);

// Display the player's points
//let playerPoints = 0;
const statusPanel = document.querySelector<HTMLDivElement>("#statusPanel")!; // element `statusPanel` is defined in index.html
statusPanel.innerHTML = "No points yet...";

// Used ChatGPT to create better markers
// Need to add more to these markers (create a pop-up)
// ChatGPT prompt: how would I create a better icon for the caches given this code
const redIcon = leaflet.icon({
  iconUrl:
    "https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png",
  iconSize: [25, 41], // Default size for Leaflet markers
  iconAnchor: [12, 41], // Position the icon so it points to the location
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
});

// Used Brace to understand Leaflet.LatLng
//
function generateCaches(
  center: leaflet.LatLng,
  neighborhoodSize: number,
  tileDegrees: number,
) {
  for (let x = -neighborhoodSize; x <= neighborhoodSize; x++) {
    for (let y = -neighborhoodSize; y <= neighborhoodSize; y++) {
      const positionKey = `${x},${y}`;
      const randomValue = luck(positionKey);

      if (randomValue < CACHE_SPAWN_PROBABILITY) {
        // Similar code to the example
        const lat = center.lat + x * tileDegrees;
        const lng = center.lng + y * tileDegrees;
        const position = leaflet.latLng(lat, lng);

        // Add the marker at this position with the custom blue icon
        const cacheMarker = leaflet.marker(position, { icon: redIcon }).addTo(
          map,
        );
        cacheMarker.bindTooltip(
          `Cache at (${lat.toFixed(5)}, ${lng.toFixed(5)})`,
        ).openTooltip();

        // testing purposes
        cacheMarker.on("click", () => {
          console.log(`Interacted with cache at position ${positionKey}`);
        });
      }
    }
  }
}

// Generate caches around the player’s initial location
generateCaches(OAKES_CLASSROOM, NEIGHBORHOOD_SIZE, TILE_DEGREES);
