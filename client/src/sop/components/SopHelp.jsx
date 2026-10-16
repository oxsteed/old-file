import {Component, Suspense, lazy} from 'react';
import {useTranslation} from 'react-i18next';
const SopGuideButton=lazy(()=>import('./SopGuideButton.jsx'));

// Optional help must never replace a working task page when its chunk fails.
class HelpBoundary extends Component {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed ? this.props.fallback : this.props.children;}
}
export default function SopHelp({user}){
 const {t}=useTranslation();
 return <div className="ox-container"><HelpBoundary fallback={<a href="/how-it-works/guides" target="_blank" rel="noopener noreferrer">{t('sop.libraryLink')}</a>}><Suspense fallback={null}><SopGuideButton user={user}/></Suspense></HelpBoundary></div>;
}
