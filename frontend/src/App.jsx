import RoutePlannerPanel from './components/RoutePlannerPanel'
import MapView from './components/MapView'
import TourOverlay from './tour/TourOverlay'

export default function App() {
  return (
    <div className="app">
      <RoutePlannerPanel />
      <MapView />
      <TourOverlay />
    </div>
  )
}
