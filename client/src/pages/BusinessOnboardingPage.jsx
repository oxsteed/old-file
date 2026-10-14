import { useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import BusinessOnboarding from '../components/businessHub/BusinessOnboarding';

export default function BusinessOnboardingPage() {
  const { businessId } = useParams();
  return <><Navbar /><main id="main-content"><BusinessOnboarding businessId={businessId} /></main><Footer /></>;
}
