import * as L from 'https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.esm.js';

// Global state
let geojsonData = null;
let csvData = {};
let map = null;
let geojsonLayer = null;
let currentVariable = 'Total_Population';

// Parse CSV manually
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',');
  const data = {};
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j].trim()] = values[j] ? values[j].trim() : null;
    }
    // Only use 2018 or most recent data for simplicity if multiple years exist
    if (!data[row.Zip_Code] || row.Year === '2022') {
      data[row.Zip_Code] = row;
    }
  }
  return data;
}

// Get color based on value
function getColor(value, variable) {
  if (value === null || value === undefined || isNaN(value)) return '#ccc';
  
  // Define breaks for different variables (simplified)
  let max = 0;
  if (variable === 'Total_Population') max = 100000;
  if (variable === 'Median_Household_Income') max = 150000;
  if (variable === 'Median_Home_Value') max = 1500000;
  if (variable === 'Below_Poverty_Level') max = 20000;
  if (variable === 'Poverty_Rate') max = 40;

  const pct = value / max;
  
  return pct > 0.9 ? '#800026' :
         pct > 0.7 ? '#BD0026' :
         pct > 0.5 ? '#E31A1C' :
         pct > 0.3 ? '#FC4E2A' :
         pct > 0.1 ? '#FD8D3C' :
         pct > 0.05 ? '#FEB24C' :
         pct > 0.01 ? '#FED976' :
                      '#FFEDA0';
}

function style(feature) {
  const zip = feature.properties.ZIP_CODE;
  const data = csvData[zip];
  const value = data ? parseFloat(data[currentVariable]) : null;
  
  return {
    fillColor: getColor(value, currentVariable),
    weight: 1,
    opacity: 1,
    color: '#666',
    dashArray: '3',
    fillOpacity: 0.7
  };
}

function onEachFeature(feature, layer) {
  const zip = feature.properties.ZIP_CODE;
  const data = csvData[zip];
  
  let tooltipContent = `<b>Zip Code: ${zip}</b><br/>`;
  if (data) {
    tooltipContent += `Population: ${data.Total_Population}<br/>`;
    tooltipContent += `Income: $${data.Median_Household_Income}<br/>`;
    tooltipContent += `Home Value: $${data.Median_Home_Value}<br/>`;
    tooltipContent += `Poverty Rate: ${data.Poverty_Rate}%<br/>`;
  } else {
    tooltipContent += 'No data available';
  }
  
  layer.bindTooltip(tooltipContent);
}

function updateMap() {
  if (geojsonLayer) {
    map.removeLayer(geojsonLayer);
  }
  
  geojsonLayer = L.geoJSON(geojsonData, {
    style: style,
    onEachFeature: onEachFeature
  }).addTo(map);
}

async function init() {
  document.getElementById('status').textContent = 'Initializing map...';
  
  // Initialize Leaflet Map
  map = L.map('mapChart').setView([36.7783, -119.4179], 6);
  
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    maxZoom: 16
  }).addTo(map);

  document.getElementById('status').textContent = 'Loading CSV data...';
  try {
    const csvResponse = await fetch('CA_Socioeconomic_Data_2018_Present.csv');
    const csvText = await csvResponse.text();
    csvData = parseCSV(csvText);
    
    document.getElementById('status').textContent = 'Loading GeoJSON data (this may take a moment)...';
    const geojsonResponse = await fetch('CA_zipcode.geojson');
    geojsonData = await geojsonResponse.json();
    
    document.getElementById('status').textContent = 'Data loaded. Rendering map...';
    updateMap();
    
    document.getElementById('status').textContent = 'Ready';
  } catch (error) {
    console.error(error);
    document.getElementById('status').textContent = 'Error loading data.';
  }

  // Handle form submission
  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    currentVariable = document.getElementById('variableSelect').value;
    updateMap();
  });
}

init();
