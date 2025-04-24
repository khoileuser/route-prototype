function initializeWithApiKey() {
    const apiKey = document.getElementById("apiKeyInput").value.trim()
    if (!apiKey) {
        alert("Please enter a valid API key")
        return
    }

    // Create and append the Google Maps script with the provided API key
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=initMap&loading=async`
    script.async = true
    script.defer = true

    script.onerror = function () {
        alert("Failed to load Google Maps. Please check your API key.")
    }

    document.getElementById("mapsScriptContainer").appendChild(script)
    document.getElementById("apiKeyOverlay").style.display = "none"
}

let map, directionsService, directionsRenderer
let routePolylines = []
let routePairs = []
const routeColors = ["#FF0000", "#0000FF", "#00FF00", "#FFA500", "#800080"]
let colorIndex = 0

function initMap() {
    directionsService = new google.maps.DirectionsService()
    directionsRenderer = new google.maps.DirectionsRenderer()

    // Set default location to RMIT Vietnam
    const defaultLocation = { lat: 10.7298304314686, lng: 106.69395680815829 }

    map = new google.maps.Map(document.getElementById("map"), {
        center: defaultLocation,
        zoom: 13,
    })

    directionsRenderer.setMap(map)

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                }

                new google.maps.Marker({
                    position: userLocation,
                    map: map,
                    title: "You are here!",
                })

                map.setCenter(userLocation)

                const pickupInput = document.getElementById("pickup")
                pickupInput.value = `${userLocation.lat},${userLocation.lng}`
            },
            (error) => {
                console.warn("Geolocation failed or was denied:", error.message)
            }
        )
    } else {
        console.warn("Geolocation not supported by this browser.")
    }
}

function getNextColor() {
    const color = routeColors[colorIndex]
    colorIndex = (colorIndex + 1) % routeColors.length
    return color
}

function addRoute() {
    const pickup = document.getElementById("pickup").value
    const destination = document.getElementById("destination").value

    if (!pickup || !destination) {
        alert("Please enter both pickup and destination")
        return
    }

    directionsService.route(
        {
            origin: pickup,
            destination: destination,
            travelMode: google.maps.TravelMode.DRIVING,
        },
        (response, status) => {
            if (status === "OK") {
                const routePath = response.routes[0].overview_path

                const polyline = new google.maps.Polyline({
                    path: routePath,
                    strokeColor: getNextColor(),
                    strokeOpacity: 0.8,
                    strokeWeight: 5,
                })

                polyline.setMap(map)
                directionsRenderer.setDirections(response)
                routePolylines.push(polyline)
                routePairs.push({ pickup, destination, path: routePath })
            } else {
                console.error("Directions request failed:", status)
            }
        }
    )
}

function clearRoutes() {
    for (let polyline of routePolylines) {
        polyline.setMap(null)
    }
    routePolylines = []
    directionsRenderer.setDirections({ routes: [] })
    routePairs = []
    colorIndex = 0
}

function optimizeRoutes(mode = "line-hash") {
    if (routePairs.length < 2) {
        alert("Add at least two routes to combine")
        return
    }

    let combinedRoutes = []
    if (mode == "line-hash") {
        combinedRoutes = combineRoutesLineHash(routePairs)
    } else if (mode == "r-tree") {
        combinedRoutes = combineRoutesRTree(routePairs)
    } else if (mode == "graph-based") {
        combinedRoutes = combineRoutesGraph(routePairs)
    }

    clearRoutes()
    for (let i = 0; i < combinedRoutes.length; i++) {
        console.log("Combined Route:", combinedRoutes[i])
        const { start, end, waypoints } = combinedRoutes[i]

        directionsService.route(
            {
                origin: start,
                destination: end,
                waypoints: waypoints,
                optimizeWaypoints: true,
                travelMode: google.maps.TravelMode.DRIVING,
            },
            (response, status) => {
                if (status === "OK") {
                    const routePath = response.routes[0].overview_path

                    const polyline = new google.maps.Polyline({
                        path: routePath,
                        strokeColor: getNextColor(),
                        strokeOpacity: 0.8,
                        strokeWeight: 5,
                    })

                    polyline.setMap(map)
                    routePolylines.push(polyline)
                } else {
                    console.error("Combined route failed:", status)
                }
            }
        )
    }
}

window.onload = initMap

function roundLatLng(latlng, precision = 5) {
    return `${latlng.lat().toFixed(precision)},${latlng
        .lng()
        .toFixed(precision)}`
}

function roundLatLngGraph(latlng, precision = 5) {
    let lat = typeof latlng.lat === "function" ? latlng.lat() : latlng.lat
    let lng = typeof latlng.lng === "function" ? latlng.lng() : latlng.lng

    if (
        typeof lat !== "number" ||
        typeof lng !== "number" ||
        isNaN(lat) ||
        isNaN(lng)
    ) {
        console.error("Invalid latlng:", latlng)
        return "0.00000,0.00000" // fallback value to prevent crashing
    }

    // Ensure precision is safe
    precision = Math.max(0, Math.min(100, precision))

    return `${lat.toFixed(precision)},${lng.toFixed(precision)}`
}

function extractSegments(path) {
    const segments = []
    for (let i = 0; i < path.length - 1; i++) {
        const from = roundLatLng(path[i])
        const to = roundLatLng(path[i + 1])
        const segmentKey = `${from}|${to}` // Directional key
        segments.push({ from: path[i], to: path[i + 1], key: segmentKey })
    }
    return segments
}

function combineRoutesLineHash(routePairs) {
    const segmentMap = new Map()
    const potentialCombinations = []
    const seenCombinations = new Set()
    const routeInCombination = new Set()

    // Index segments from each route
    for (let i = 0; i < routePairs.length; i++) {
        const { path } = routePairs[i]
        const segments = extractSegments(path)

        for (let { key } of segments) {
            if (!segmentMap.has(key)) {
                segmentMap.set(key, new Set())
            }
            segmentMap.get(key).add(i)
        }
    }

    // Try to form combinations from shared segments
    for (let segmentRoutes of segmentMap.values()) {
        const routeIndices = Array.from(segmentRoutes)

        if (routeIndices.length > 1) {
            const sortedKey = routeIndices.sort().join("-")
            if (!seenCombinations.has(sortedKey)) {
                seenCombinations.add(sortedKey)

                // Sort routes by path length (or another metric) to choose the longest path as main
                const sortedRoutes = routeIndices.sort((a, b) => {
                    return routePairs[b].path.length - routePairs[a].path.length
                })

                const mainRoute = routePairs[sortedRoutes[0]]
                const combined = {
                    start: mainRoute.pickup,
                    end: mainRoute.destination,
                    waypoints: [],
                }

                const wpSet = new Set()
                for (let i = 0; i < sortedRoutes.length; i++) {
                    const { pickup, destination } = routePairs[sortedRoutes[i]]
                    routeInCombination.add(sortedRoutes[i])

                    // Skip adding main start and end again
                    if (pickup !== combined.start && pickup !== combined.end) {
                        wpSet.add(pickup)
                    }
                    if (
                        destination !== combined.end &&
                        destination !== combined.start
                    ) {
                        wpSet.add(destination)
                    }
                }

                // Sort waypoints based on their order in the main path
                const mainPath = mainRoute.path.map((p) => roundLatLng(p))
                const sortedWaypoints = Array.from(wpSet).sort((a, b) => {
                    const indexA = mainPath.indexOf(a)
                    const indexB = mainPath.indexOf(b)
                    return indexA - indexB
                })

                combined.waypoints = Array.from(sortedWaypoints).map((loc) => ({
                    location: loc,
                }))
                potentialCombinations.push(combined)
            }
        }
    }

    // Add any ungrouped routes
    for (let i = 0; i < routePairs.length; i++) {
        if (!routeInCombination.has(i)) {
            const { pickup, destination } = routePairs[i]
            potentialCombinations.push({
                start: pickup,
                end: destination,
                waypoints: [],
            })
        }
    }

    return potentialCombinations
}

function extractSegmentBBoxes(path) {
    const segments = []
    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i]
        const p2 = path[i + 1]
        const minX = Math.min(p1.lng(), p2.lng())
        const minY = Math.min(p1.lat(), p2.lat())
        const maxX = Math.max(p1.lng(), p2.lng())
        const maxY = Math.max(p1.lat(), p2.lat())

        segments.push({
            minX,
            minY,
            maxX,
            maxY,
            from: p1,
            to: p2,
            routeIndex: null, // Filled later
        })
    }
    return segments
}

function segmentSimilarity(seg1, seg2, threshold = 0.0005) {
    const dist = (p1, p2) =>
        Math.sqrt(
            Math.pow(p1.lat() - p2.lat(), 2) + Math.pow(p1.lng() - p2.lng(), 2)
        )

    const closeEnough =
        dist(seg1.from, seg2.from) < threshold &&
        dist(seg1.to, seg2.to) < threshold
    return closeEnough
}

function combineRoutesRTree(routePairs) {
    const tree = new RBush()
    const routeSegments = []
    const segmentMap = new Map()
    const seenCombinations = new Set()
    const routeInCombination = new Set()
    const potentialCombinations = []

    // Index all segments with routeIndex
    for (let i = 0; i < routePairs.length; i++) {
        const { path } = routePairs[i]
        const segments = extractSegmentBBoxes(path)
        segments.forEach((seg) => {
            seg.routeIndex = i
            tree.insert(seg)
            routeSegments.push(seg)
        })
    }

    // Group routes with overlapping segments using similarity
    const overlaps = new Map()
    for (let seg of routeSegments) {
        const candidates = tree.search(seg)
        for (let other of candidates) {
            if (
                seg.routeIndex !== other.routeIndex &&
                segmentSimilarity(seg, other)
            ) {
                const pair = [seg.routeIndex, other.routeIndex].sort()
                const key = pair.join("-")
                if (!overlaps.has(key)) overlaps.set(key, new Set())
                overlaps.get(key).add(seg.routeIndex)
                overlaps.get(key).add(other.routeIndex)
            }
        }
    }

    for (let [key, routeSet] of overlaps.entries()) {
        const sortedRoutes = Array.from(routeSet).sort((a, b) => {
            return routePairs[b].path.length - routePairs[a].path.length
        })

        const mainRoute = routePairs[sortedRoutes[0]]
        const combined = {
            start: mainRoute.pickup,
            end: mainRoute.destination,
            waypoints: [],
        }

        const wpSet = new Set()
        for (let idx of sortedRoutes) {
            const { pickup, destination } = routePairs[idx]
            routeInCombination.add(idx)

            if (pickup !== combined.start && pickup !== combined.end) {
                wpSet.add(pickup)
            }
            if (
                destination !== combined.end &&
                destination !== combined.start
            ) {
                wpSet.add(destination)
            }
        }

        // Sort waypoints based on appearance in main route
        const mainPath = mainRoute.path.map((p) => roundLatLng(p))
        const sortedWaypoints = Array.from(wpSet).sort((a, b) => {
            const indexA = mainPath.indexOf(a)
            const indexB = mainPath.indexOf(b)
            return indexA - indexB
        })

        combined.waypoints = sortedWaypoints.map((loc) => ({ location: loc }))
        potentialCombinations.push(combined)
    }

    // Add leftover routes
    for (let i = 0; i < routePairs.length; i++) {
        if (!routeInCombination.has(i)) {
            const { pickup, destination } = routePairs[i]
            potentialCombinations.push({
                start: pickup,
                end: destination,
                waypoints: [],
            })
        }
    }

    return potentialCombinations
}

function combineRoutesGraph(routePairs) {
    const graph = new Map() // Node => Array of {to, routes: Set}
    const edgeToRoutes = new Map() // edgeKey => Set of route indices

    // 1. Build the graph
    for (let i = 0; i < routePairs.length; i++) {
        const { path } = routePairs[i]
        const segments = extractSegments(path)

        for (let { from, to, key } of segments) {
            if (!graph.has(from)) graph.set(from, [])
            graph.get(from).push({ to, route: i })

            if (!edgeToRoutes.has(key)) edgeToRoutes.set(key, new Set())
            edgeToRoutes.get(key).add(i)
        }
    }

    const seenCombinations = new Set()
    const routeInCombination = new Set()
    const potentialCombinations = []

    // 2. Find shared edges between routes
    for (let [key, routeSet] of edgeToRoutes.entries()) {
        const routeIndices = Array.from(routeSet)
        if (routeIndices.length <= 1) continue

        const sortedKey = routeIndices.sort().join("-")
        if (seenCombinations.has(sortedKey)) continue
        seenCombinations.add(sortedKey)

        // Use the longest route as the base
        const sortedRoutes = routeIndices.sort(
            (a, b) => routePairs[b].path.length - routePairs[a].path.length
        )
        const mainRoute = routePairs[sortedRoutes[0]]

        const combined = {
            start: mainRoute.pickup,
            end: mainRoute.destination,
            waypoints: [],
        }

        const wpSet = new Set()
        for (let routeIndex of sortedRoutes) {
            routeInCombination.add(routeIndex)

            const { pickup, destination } = routePairs[routeIndex]
            if (pickup !== combined.start && pickup !== combined.end)
                wpSet.add(pickup)
            if (destination !== combined.start && destination !== combined.end)
                wpSet.add(destination)
        }

        // Order waypoints as in the main route's path
        const mainPathRounded = mainRoute.path.map(roundLatLngGraph)
        const sortedWaypoints = Array.from(wpSet).sort((a, b) => {
            const indexA = mainPathRounded.indexOf(a)
            const indexB = mainPathRounded.indexOf(b)
            return indexA - indexB
        })

        combined.waypoints = sortedWaypoints.map((loc) => ({ location: loc }))
        potentialCombinations.push(combined)
    }

    // 3. Add uncombined routes
    for (let i = 0; i < routePairs.length; i++) {
        if (!routeInCombination.has(i)) {
            const { pickup, destination } = routePairs[i]
            potentialCombinations.push({
                start: pickup,
                end: destination,
                waypoints: [],
            })
        }
    }

    return potentialCombinations
}
