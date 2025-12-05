
// DOM Elements
const addressInput = document.getElementById('address');
const suggestionsBox = document.getElementById('address-suggestions');
const inputGroup = document.querySelector('.input-group.full-width'); // Parent for relative positioning
const calculateBtn = document.getElementById('calculate-btn');
const resultsSection = document.getElementById('results');

// Inputs
const inputPeakPower = document.getElementById('peakpower');
const inputAngle = document.getElementById('angle');
const inputAspect = document.getElementById('aspect');

// Output Elements
const outProduction = document.getElementById('yearly-production');
const outSavings = document.getElementById('yearly-savings'); // <--- Added this line
const outLocation = document.getElementById('meta-location');
const outIrradiance = document.getElementById('meta-irradiance');

// State
let selectedLat = null;
let selectedLon = null;
let debounceTimer;

// --- Geocoding (Nominatim) ---

addressInput.addEventListener('input', (e) => {
    const query = e.target.value;
    clearTimeout(debounceTimer);

    if (query.length < 3) {
        suggestionsBox.classList.add('hidden');
        return;
    }

    debounceTimer = setTimeout(() => {
        fetchAddressSuggestions(query);
    }, 500); // 500ms debounce
});

async function fetchAddressSuggestions(query) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`, {
            headers: {
                'User-Agent': 'SolarCalcApp/1.0' // Required by Nominatim policy
            }
        });
        const data = await response.json();
        renderSuggestions(data);
    } catch (error) {
        console.error('Geocoding error:', error);
    }
}

function renderSuggestions(data) {
    suggestionsBox.innerHTML = '';
    if (data.length === 0) {
        suggestionsBox.classList.add('hidden');
        return;
    }

    data.forEach(item => {
        const div = document.createElement('div');
        div.classList.add('suggestion-item');
        div.innerHTML = `
            <span>${item.display_name}</span>
            <small style="display: block; color: #888; font-size: 0.8em; margin-top: 2px;">
                ${parseFloat(item.lat).toFixed(3)}, ${parseFloat(item.lon).toFixed(3)}
            </small>
        `;
        div.addEventListener('click', () => {
            selectAddress(item);
        });
        suggestionsBox.appendChild(div);
    });

    suggestionsBox.classList.remove('hidden');
}

const coordsDisplay = document.getElementById('selected-coordinates');

function selectAddress(item) {
    addressInput.value = item.display_name;
    selectedLat = item.lat;
    selectedLon = item.lon;
    suggestionsBox.classList.add('hidden');

    // Show coordinates immediately
    coordsDisplay.textContent = `📍 ${parseFloat(item.lat).toFixed(4)}, ${parseFloat(item.lon).toFixed(4)}`;
    coordsDisplay.classList.remove('hidden');

    // Nice UX: Focus the button to encourage clicking it
    calculateBtn.focus();
}

// Close suggestions if clicking outside
document.addEventListener('click', (e) => {
    if (!inputGroup.contains(e.target)) {
        suggestionsBox.classList.add('hidden');
    }
});


// --- Solar Calculation (PVGIS) ---

calculateBtn.addEventListener('click', async () => {
    if (!selectedLat || !selectedLon) {
        alert('Please select a valid address from the list.');
        return;
    }

    calculateBtn.textContent = 'Calculating...';
    calculateBtn.disabled = true;

    try {
        await getSolarData();
        resultsSection.classList.remove('hidden');
        resultsSection.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        alert(`Error fetching solar data: ${error.message}`);
        console.error(error);
    } finally {
        calculateBtn.textContent = 'Calculate Production';
        calculateBtn.disabled = false;
    }
});

async function getSolarData() {
    const peakPower = inputPeakPower.value;
    const angle = inputAngle.value;
    // User Input: 0 = North, 90 = East, 180 = South
    // PVGIS: 0 = South, -90 = East, 90 = West
    // formula: PVGIS = User - 180
    // Example: User 90 (East) - 180 = -90 (PVGIS East)
    const userAspect = inputAspect.value;
    const aspect = userAspect - 180;
    const loss = 14; // Standard system loss %

    // PVGIS API v5.2
    const targetUrl = `https://re.jrc.ec.europa.eu/api/v5_2/PVcalc?lat=${selectedLat}&lon=${selectedLon}&peakpower=${peakPower}&loss=${loss}&angle=${angle}&aspect=${aspect}&outputformat=json`;

    // List of proxies to try in order
    const proxies = [
        (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];

    let response = null;
    let lastError = null;

    for (const proxyGen of proxies) {
        try {
            const proxyUrl = proxyGen(targetUrl);
            console.log(`Trying proxy: ${proxyUrl}`);
            const res = await fetch(proxyUrl);
            if (res.ok) {
                response = res;
                break; // Success!
            } else {
                console.warn(`Proxy failed: ${res.status}`);
            }
        } catch (e) {
            console.warn(`Proxy error: ${e.message}`);
            lastError = e;
        }
    }

    if (!response || !response.ok) {
        throw new Error(`All proxies failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
    }

    const data = await response.json();
    displayResults(data);
}

function displayResults(data) {
    console.log("PVGIS Data:", data); // Debug for user if needed

    // PVGIS returns data structured by mounting type (fixed, inclined_axis, etc.)
    // We dynamically find the key to be safe.
    const mountingType = Object.keys(data.outputs.totals)[0];
    const totals = data.outputs.totals[mountingType];
    const monthly = data.outputs.monthly[mountingType];

    if (!totals) {
        alert("Error: Could not find solar data totals.");
        return;
    }

    // 1. Yearly Energy Production (E_y)
    const yearlyEnergy = totals.E_y; // kWh

    // 2. Yearly In-plane Irradiation (H(i)_y)
    const yearlyIrradiance = totals['H(i)_y']; // kWh/m2

    // 3. Calculate Savings
    const costPerKwh = parseFloat(document.getElementById('kwh-cost').value) || 0;
    const yearlySavings = yearlyEnergy * costPerKwh;

    // Animate the number counting up
    // Ensure we have a valid number, default to 0 if missing
    const validEnergy = yearlyEnergy || 0;
    const validIrradiance = yearlyIrradiance || 0;

    animateValue(outProduction, 0, Math.round(validEnergy), 1500);

    // Animate Savings (formatted currency)
    // Using a simple animation helper for currency might be tricky with commas, 
    // but let's just animate the integer part for now or custom logic.
    // Simpler: Just animate the number value
    animateValue(outSavings, 0, Math.round(yearlySavings), 1500, "");

    outIrradiance.textContent = Math.round(validIrradiance);

    // We don't get a clean "City" name from PVGIS, so we keep the address input or just "Lat/Lon"
    // For now let's just show coordinates formatted nicely
    outLocation.textContent = `${parseFloat(selectedLat).toFixed(2)}, ${parseFloat(selectedLon).toFixed(2)}`;

    renderChart(monthly);
}


let productionChart = null;

function renderChart(monthlyData) {
    const ctx = document.getElementById('production-chart');
    if (!ctx) {
        // Create canvas if it doesn't exist
        const container = document.getElementById('chart-container');
        container.innerHTML = '<canvas id="production-chart"></canvas>';
    }

    // Prepare data
    const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dataPoints = monthlyData.map(m => m.E_m); // E_m is monthly energy in kWh

    const chartCanvas = document.getElementById('production-chart').getContext('2d');

    if (productionChart) {
        productionChart.destroy();
    }

    // Chart.js Configuration
    Chart.defaults.font.family = "'Outfit', sans-serif";
    Chart.defaults.color = '#a0a0a0';

    productionChart = new Chart(chartCanvas, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Monthly Production (kWh)',
                data: dataPoints,
                backgroundColor: 'rgba(255, 189, 46, 0.6)',
                borderColor: '#ffbd2e',
                borderWidth: 1,
                borderRadius: 4,
                hoverBackgroundColor: '#ffbd2e'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 32, 38, 0.9)',
                    titleColor: '#fff',
                    bodyColor: '#ffbd2e',
                    borderWidth: 1,
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    callbacks: {
                        label: function (context) {
                            return context.parsed.y + ' kWh';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)'
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}


// Helper to animate numbers
function animateValue(obj, start, end, duration, prefix = "") {
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);

        const currentVal = Math.floor(progress * (end - start) + start);
        obj.innerHTML = prefix + currentVal.toLocaleString(); // Add formatting

        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    window.requestAnimationFrame(step);
}
