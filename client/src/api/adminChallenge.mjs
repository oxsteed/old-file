export function createAdminChallengeHandler(location) {
  let navigating = false;
  return (error) => {
    if (navigating || location.pathname === '/admin/2fa-setup') return;
    if (error.response?.status === 403 &&
        error.response?.data?.code === 'admin_2fa_required') {
      navigating = true;
      location.replace('/admin/2fa-setup');
    }
  };
}
