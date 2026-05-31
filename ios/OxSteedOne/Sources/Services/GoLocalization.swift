import Foundation

enum OneLocalization {
    static func appName() -> String { "OxSteed One" }

    static func localized(_ key: String, language: AppLanguage, fallback: String) -> String {
        table[language]?[key] ?? table[.english]?[key] ?? fallback
    }

    private static let table: [AppLanguage: [String: String]] = [
        .english: [
            "app.name": "OxSteed One",
            "auth.title": "One Account. Many Roles.",
            "auth.subtitle": "Sign in to load your personas, messages, and transactions.",
            "auth.sign_in": "Sign In",
            "auth.create_account": "Create Account",
            "auth.welcome_back": "Welcome Back",
            "auth.full_legal_name": "Full legal name",
            "auth.email": "Email",
            "auth.password": "Password",
            "auth.first_name": "First name",
            "auth.last_name": "Last name",
            "auth.persona": "Persona",
            "auth.accept_terms": "I agree to Terms of Service and Privacy Policy",
            "auth.create_account_title": "Create Account",
            "auth.primary_persona": "Primary Persona",
            "onboarding.welcome": "Welcome",
            "onboarding.welcome_description": "Set up your first persona and pulse pillars. Pulse is never zero on first launch.",
            "onboarding.pulse_pillars": "Pulse Pillars",
            "onboarding.pillar_money": "Money",
            "onboarding.pillar_home_care": "Home Care",
            "onboarding.pillar_car_care": "Car Care",
            "onboarding.pillar_personal_care": "Personal Care",
            "onboarding.pillar_goals": "Goals",
            "onboarding.pillar_planned_needs": "Planned Needs",
            "onboarding.finish_setup": "Finish Setup",
            "onboarding.get_started": "Get Started",
            "home.guest_section_open_jobs": "Open Jobs",
            "home.guest_section_available_helpers": "Available Helpers",
            "home.guest_section_tool_rentals": "Tool Rentals",
            "home.guest_section_open_jobs_subtitle": "See live customer needs before joining as a helper.",
            "home.guest_section_available_helpers_subtitle": "Find local service providers and compare trust signals.",
            "home.guest_section_tool_rentals_subtitle": "Browse nearby tools before reserving.",
            "home.browse_help_jobs_tools": "Browse local help, jobs, and tools",
            "home.search_placeholder_text": "Search jobs, helpers, or tools",
            "home.guest_section_jobs": "Jobs",
            "home.guest_section_helpers": "Helpers",
            "home.guest_section_tools": "Tools",
            "home.guest_empty_state_title": "No matching public listings",
            "home.guest_empty_state_body": "Try a different search or refresh public listings.",
            "home.location_local_area": "Local area",
            "home.rating_label": "Rating",
            "home.rating_stars": "stars.",
            "home.rate_prefix": "Starting around",
            "guest.item_detail_job_prompt": "Sign in to message, bid, or manage this job.",
            "guest.action_view_job": "Sign in to view job",
            "guest.action_book": "Sign in to book",
            "guest.action_reserve_prompt": "Sign in to reserve, coordinate pickup, and protect your deposit.",
            "guest.action_reserve": "Sign in to reserve",
            "common.done": "Done",
            "profile.settings": "Settings",
            "profile.security": "Security",
            "profile.communication": "Communication",
            "profile.push_title": "Push Notifications",
            "profile.push_enable": "Enable Push Notifications",
            "profile.push_authorized": "Authorized",
            "profile.push_denied": "Denied in system settings",
            "profile.push_not_determined": "Not requested yet",
            "profile.push_unknown": "Unknown",
            "profile.sign_out": "Sign Out",
            "force_update.title": "Update Required",
            "force_update.body": "Please update OxSteed One to continue.",
            "lock.title": "OxSteed One Locked",
            "lock.button": "Unlock with Face ID / Touch ID",
            "sync.offline": "Offline Mode",
            "sync.pending": "Sync Queue Pending",
            "sync.offline_detail": "Changes are saved locally and will sync when connection returns.",
            "sync.button": "Sync",
            "home.sync_pending_changes": "change(s) waiting to sync.",
            "home.title": "Home",
            "home.universal_search": "Universal Search",
            "home.universal_search_note": "Saved search alerts and map overlays are next implementation step.",
            "home.search_results": "Search Results",
            "home.no_search_results": "No matches found across Home, Life, Growth, and Learn.",
            "home.discovery_views": "Discovery Views",
            "home.discovery_description": "Feed, Map, and List are unified by persona-aware search context.",
            "home.discovery_feed": "Feed",
            "home.discovery_map": "Map",
            "home.discovery_list": "List",
            "home.discovery_alerts": "Alerts",
            "home.saved_alert_example": "Saved alert example: plumber under $150 in Springfield",
            "home.customer_transactions": "Customer Transactions",
            "home.sync_live_data": "Sync Live Data",
            "home.syncing": "Syncing...",
            "home.last_sync": "Last sync:",
            "home.refreshes_customer_data": "Refreshes jobs, bids, helpers, appointments, and rentals from",
            "home.loading_jobs": "Loading your jobs…",
            "home.loading_bookings": "Loading bookings…",
            "home.loading_rental_tools": "Loading rental tools…",
            "home.saved_search_alerts": "Saved Search Alerts",
            "home.create_alert_query": "Create alert query",
            "home.add": "Add",
            "home.map_view": "Map View",
            "home.refresh_map_for_active_persona": "Refresh Map for Active Persona",
            "home.trust_and_safety": "Trust & Safety",
            "home.stop_safety_timer": "Stop Safety Timer",
            "home.start_safety_timer": "Start Safety Timer",
            "home.sos": "SOS",
            "home.sos_triggered": "SOS triggered: location + incident log queued.",
            "home.two_way_reviews": "Two-Way Reviews",
            "home.from": "From",
            "home.customer": "Customer",
            "home.helper": "Helper",
            "home.business_owner": "Business Owner",
            "home.to": "To",
            "home.rating": "Rating",
            "home.review_comment": "Review comment",
            "home.submit_review": "Submit Review",
            "home.loading_jobs_near_you": "Loading jobs near you…",
            "home.customer_job_posting": "Customer Job Posting",
            "home.bids_comparison": "Bids + Comparison",
            "home.customer_service_booking": "Customer Service Booking",
            "home.tool_rental_flow": "Tool Rental Flow",
            "home.save_draft": "Save Draft",
            "home.publish_job": "Publish Job + Notify Helpers",
            "home.load_more_jobs": "Load More Jobs",
            "home.load_more_bookings": "Load More Bookings",
            "home.load_more_rentals": "Load More Rentals",
            "home.loading": "Loading...",
            "home.search_placeholder": "Search jobs, helpers, tools, training, financing",
            "home.run_today_build_tomorrow": "Run today. Build tomorrow.",
            "home.one_account_many_personas": "One account. Many personas. Home updates instantly.",
            "home.persona": "Persona:",
            "home.role": "Role:",
            "home.profile_settings": "Profile & Settings",
            "home.select_business": "Select Business",
            "home.job_title": "Job title",
            "home.category": "Category",
            "home.category_plumbing": "Plumbing",
            "home.category_electrical": "Electrical",
            "home.category_hvac": "HVAC",
            "home.category_carpentry": "Carpentry",
            "home.category_cleaning": "Cleaning",
            "home.location_autocomplete": "Location autocomplete",
            "home.address": "Address",
            "home.describe_work": "Describe the work",
            "home.add_photos": "Add Photos (up to 5)",
            "home.uploading_photos": "Uploading photos…",
            "home.publishing_job": "Publishing job…",
            "home.retry": "Retry",
            "home.publish": "Publish",
            "home.start": "Start",
            "home.complete": "Complete",
            "home.cancel": "Cancel",
            "home.post_job_for_bids": "Post a job to start receiving bids.",
            "home.job_picker": "Job",
            "home.sort": "Sort",
            "home.price_low_to_high": "Price Low→High",
            "home.price_high_to_low": "Price High→Low",
            "home.helper_a_to_z": "Helper A→Z",
            "home.accepted": "Accepted",
            "home.accept_create_appointment": "Accept + Create Appointment",
            "home.message": "Message",
            "home.message_default_content": "Can you confirm scope and timeline?",
            "home.message_helper": "Message helper",
            "home.refreshing_bids": "Refreshing bids...",
            "home.retry_bid_sync": "Retry Bid Sync",
            "home.search_helpers": "Search helpers",
            "home.min_rating": "Min rating:",
            "home.availability": "Availability:",
            "home.service_type": "Service type",
            "home.date": "Date",
            "home.time_slot": "Time slot",
            "home.payment_authorization": "Payment authorization",
            "home.pre_appointment_message": "Pre-appointment message",
            "home.book_service": "Book Service",
            "home.creating_booking": "Creating booking...",
            "home.payment_prefix": "Payment:",
            "home.payment_authorized": "authorized",
            "home.payment_pending": "pending",
            "home.post_appointment_message": "Post-appointment message",
            "home.confirm_payment": "Confirm Payment",
            "home.send_update": "Send Update",
            "home.cancel_booking": "Cancel Booking",
            "home.review_note": "Review note",
            "home.retry_booking_sync": "Retry Booking Sync",
            "home.search_tool_rentals": "Search tool rentals",
            "home.max_daily_rate": "Max daily rate:",
            "home.tool_picker": "Tool",
            "home.terms": "Terms:",
            "home.available": "Available:",
            "home.reservation_slot": "Reservation slot",
            "home.reserve_tool": "Reserve Tool",
            "home.reserving_tool": "Reserving tool...",
            "home.deposit": "Deposit:",
            "home.dispute": "Dispute:",
            "home.pickup": "Pickup",
            "home.return": "Return",
            "home.resolve_dispute": "Resolve Dispute",
            "home.open_dispute": "Open Dispute",
            "home.damage_assessment": "Damage assessment",
            "home.save_damage_notes": "Save Damage Notes",
            "home.retry_rental_sync": "Retry Rental Sync",
            "settings.active_persona": "Active Persona",
            "settings.persona": "Persona",
            "settings.business": "Business",
            "settings.choose_business": "Choose Business",
            "settings.language_localization": "Language & Localization",
            "settings.display_privacy": "Display & Privacy",
            "settings.availability_manager": "Availability Manager",
            "settings.account_recovery_export": "Account Recovery & Export",
            "settings.request_data_export": "Request Data Export",
            "settings.request_account_deletion": "Request Account Deletion",
            "settings.notification_preferences_persona": "Notification Preferences by Persona",
            "settings.app_api": "App API"
            ,"profile.sub_role": "Sub-role"
            ,"profile.assigned_role": "Assigned Role"
            ,"profile.selected_business": "Selected Business"
            ,"profile.no_business_selected": "No business selected"
            ,"profile.locale": "Locale"
            ,"profile.layout_direction": "Layout direction"
            ,"profile.layout_rtl": "RTL"
            ,"profile.layout_ltr": "LTR"
            ,"profile.security_section": "Security"
            ,"profile.auto_translate_previews": "Auto-translate inbox previews"
            ,"profile.recovery_snapshot_ready": "Recovery snapshot ready for restore on new device."
            ,"profile.recovery_snapshot_not_ready": "Recovery snapshot not ready."
            ,"profile.export_request_queued": "Export request queued."
            ,"profile.account_deletion_submitted": "Account deletion request submitted."
            ,"settings.language": "Language"
            ,"settings.appearance": "Appearance"
            ,"settings.large_text_mode": "Large text mode"
            ,"settings.privacy_mode": "Privacy mode (mask sensitive values)"
            ,"settings.analytics_signals": "Allow analytics signals"
            ,"settings.persona": "Persona"
            ,"settings.alerts": "alerts"
            ,"settings.radius": "Radius"
            ,"settings.miles": "miles"
            ,"settings.quiet_hours": "Quiet hours"
            ,"settings.api_base_url": "API Base URL"
            ,"settings.active": "Active"
            ,"settings.save_api_url": "Save API URL"
            ,"settings.test_connection": "Test Connection"
            ,"settings.probe_auth_endpoints": "Probe Auth Endpoints"
            ,"settings.syncing": "Syncing..."
            ,"settings.sync_now": "Sync Now"
            ,"shop.growth_title": "Growth"
            ,"shop.economic_mobility_ladder": "Economic Mobility Ladder"
            ,"shop.ladder_path": "Skill → Side Income → Licensed Business → Scaled Operation"
            ,"shop.next_step": "Next Step:"
            ,"shop.business_ascension": "Business Ascension"
            ,"shop.business_ascension_detail": "Apply to move from side work to licensed operation."
            ,"shop.community_wholesale_groups": "Community Wholesale Groups"
            ,"shop.community_wholesale_groups_detail": "Join neighborhood bulk-buy campaigns."
            ,"shop.financing_prequalification": "Financing Pre-Qualification"
            ,"shop.financing_prequalification_detail": "Micro-loans, equipment, and startup financing pathways."
            ,"shop.grants_and_subsidies": "Grants & Subsidies"
            ,"shop.grants_and_subsidies_detail": "Location-aware opportunities for your trade."
            ,"shop.business_ascension_application": "Business Ascension Application"
            ,"shop.full_name": "Full name"
            ,"shop.current_skill": "Current skill"
            ,"shop.target_license_business": "Target license/business"
            ,"shop.submit_ascension_application": "Submit Ascension Application"
            ,"shop.status_label": "Status:"
            ,"shop.ascension_status_not_started": "Start Business Ascension application"
            ,"shop.ascension_status_submitted": "Complete Learning tab courses for your license track"
            ,"shop.ascension_status_financing_pending": "Submit financing pre-qualification"
            ,"shop.ascension_status_default": "Join a wholesale group and execute first scaled operation"
            ,"shop.community_wholesale_groups_header": "Community Wholesale Groups"
            ,"shop.join": "Join"
            ,"shop.joined": "Joined"
            ,"shop.requested_amount": "Requested amount"
            ,"shop.purpose": "Purpose"
            ,"shop.monthly_revenue": "Monthly revenue"
            ,"shop.credit_band": "Credit band"
            ,"shop.credit_fair": "Fair"
            ,"shop.credit_good": "Good"
            ,"shop.credit_very_good": "Very Good"
            ,"shop.submit_prequalification": "Submit Pre-Qualification"
            ,"shop.apply": "Apply"
            ,"shop.progress_tracker": "Progress Tracker"
            ,"shop.progress_step_skill": "Skill"
            ,"shop.progress_step_side_income": "Side Income"
            ,"shop.progress_step_licensed_business": "Licensed Business"
            ,"shop.progress_step_scaled_operation": "Scaled Operation"
            ,"shop.current_step": "Current Step"
            ,"shop.tax_document_center": "Tax Document Center"
            ,"shop.tax_document_description": "Annual 1099-style summary and deductible tracking."
            ,"shop.tax_year": "Tax Year"
            ,"shop.gross": "Gross"
            ,"shop.deductions": "Deductions"
            ,"shop.voice_input": "Voice Input"
            ,"shop.voice_input_enable_label": "Enable voice input for posting and chat"
            ,"shop.voice_input_description": "Language-aware dictation path follows selected app language."
            ,"shop.live_growth_data": "Live Growth Data"
            ,"shop.sync_live_data": "Sync Live Data"
            ,"shop.wallet": "Wallet"
            ,"shop.available": "Available"
            ,"shop.pending_escrow": "Pending escrow"
            ,"shop.payout_method": "Payout method"
            ,"shop.update_payout_method": "Update payout method"
            ,"shop.save_payout_method": "Save Payout Method"
            ,"shop.transaction_history": "Transaction History"
            ,"shop.transaction_title": "Transaction title"
            ,"shop.amount": "Amount"
            ,"shop.credit": "Credit"
            ,"shop.add_transaction": "Add Transaction"
            ,"shop.consultant_profile_snapshot": "Consultant Profile Snapshot"
            ,"shop.packages_label": "Packages: %d"
            ,"shop.appointments_label": "Appointments: %d"
            ,"shop.notes_label": "Notes: %d"
            ,"shop.sync_growth_data_hint": "Sync Live Data to load consultant profile."
            ,"shop.tool_owner_inventory": "Tool Owner Inventory"
            ,"shop.sync_tool_inventory_hint": "Sync Live Data to load inventory."
            ,"shop.available_prefix": "Available:"
            ,"shop.pending_returns": "Pending returns"
            ,"shop.quote_builder": "Quote Builder"
            ,"shop.customer_name": "Customer name"
            ,"shop.labor_amount": "Labor amount"
            ,"shop.material_amount": "Material amount"
            ,"shop.quote_notes": "Notes"
            ,"shop.save_quote_draft": "Save Quote Draft"
            ,"shop.recurring_services": "Recurring Services"
            ,"shop.service_title": "Service title"
            ,"shop.frequency": "Frequency"
            ,"shop.frequency_weekly": "Weekly"
            ,"shop.frequency_bi_weekly": "Bi-weekly"
            ,"shop.frequency_monthly": "Monthly"
            ,"shop.frequency_label_next_date": "Next date"
            ,"shop.create_plan": "Create Plan"
            ,"shop.status_active": "Active"
            ,"shop.status_paused": "Paused"
            ,"shop.financing_status_not_started": "Not Started"
            ,"shop.financing_status_submitted": "Submitted"
            ,"shop.pause": "Pause"
            ,"shop.resume": "Resume"
        ],
        .spanish: [
            "app.name": "OxSteed One",
            "auth.title": "Una cuenta. Muchos roles.",
            "auth.subtitle": "Inicia sesión para cargar tus perfiles, mensajes y transacciones.",
            "auth.sign_in": "Iniciar sesión",
            "auth.create_account": "Crear cuenta",
            "auth.welcome_back": "Bienvenido de nuevo",
            "auth.full_legal_name": "Nombre legal completo",
            "auth.email": "Correo electrónico",
            "auth.password": "Contraseña",
            "auth.first_name": "Nombre",
            "auth.last_name": "Apellido",
            "auth.persona": "Perfil",
            "common.done": "Listo",
            "onboarding.welcome": "Bienvenido",
            "onboarding.welcome_description": "Configura tu primera persona y tus pilares de pulso. El pulso nunca es cero al iniciar por primera vez.",
            "onboarding.pulse_pillars": "Pilares de pulso",
            "onboarding.pillar_money": "Dinero",
            "onboarding.pillar_home_care": "Cuidado del hogar",
            "onboarding.pillar_car_care": "Cuidado del auto",
            "onboarding.pillar_personal_care": "Cuidado personal",
            "onboarding.pillar_goals": "Metas",
            "onboarding.pillar_planned_needs": "Necesidades planificadas",
            "onboarding.finish_setup": "Completar configuración",
            "onboarding.get_started": "Empezar",
            "home.guest_section_open_jobs": "Trabajos abiertos",
            "home.guest_section_available_helpers": "Ayudantes disponibles",
            "home.guest_section_tool_rentals": "Alquiler de herramientas",
            "home.guest_section_open_jobs_subtitle": "Consulta las necesidades de los clientes en tiempo real antes de unirte como ayudante.",
            "home.guest_section_available_helpers_subtitle": "Encuentra proveedores de servicios locales y compara señales de confianza.",
            "home.guest_section_tool_rentals_subtitle": "Explora herramientas cercanas antes de reservar.",
            "home.browse_help_jobs_tools": "Explora ayuda local, trabajos y herramientas",
            "home.search_placeholder_text": "Buscar empleos, ayudantes o herramientas",
            "home.guest_section_jobs": "Trabajos",
            "home.guest_section_helpers": "Ayudantes",
            "home.guest_section_tools": "Herramientas",
            "home.guest_empty_state_title": "No se encontraron listados públicos coincidentes",
            "home.guest_empty_state_body": "Prueba una búsqueda diferente o actualiza los listados públicos.",
            "home.location_local_area": "Área local",
            "home.rating_label": "Calificación",
            "home.rating_stars": "estrellas.",
            "home.rate_prefix": "A partir de",
            "guest.item_detail_job_prompt": "Inicia sesión para enviar mensajes, hacer una oferta o gestionar este trabajo.",
            "guest.action_view_job": "Inicia sesión para ver este trabajo",
            "guest.action_book": "Inicia sesión para reservar",
            "guest.action_reserve_prompt": "Inicia sesión para reservar, coordinar la recogida y proteger tu depósito.",
            "guest.action_reserve": "Inicia sesión para reservar",
            "profile.settings": "Configuración",
            "profile.security": "Seguridad",
            "profile.communication": "Comunicación",
            "profile.push_title": "Notificaciones Push",
            "profile.push_enable": "Activar notificaciones Push",
            "profile.sign_out": "Cerrar sesión",
            "force_update.title": "Actualización requerida",
            "force_update.body": "Actualiza OxSteed One para continuar.",
            "lock.title": "OxSteed One bloqueado",
            "lock.button": "Desbloquear con Face ID / Touch ID",
            "sync.offline": "Modo sin conexión",
            "sync.pending": "Sincronización pendiente",
            "sync.button": "Sincronizar",
            "sync.offline_detail": "Los cambios se guardan localmente y se sincronizarán cuando vuelva la conexión.",
            "home.title": "Inicio",
            "home.universal_search": "Búsqueda universal",
            "home.universal_search_note": "Las alertas de búsqueda guardadas y superposiciones del mapa se implementarán después.",
            "home.search_results": "Resultados de búsqueda",
            "home.no_search_results": "No se encontraron coincidencias en Inicio, Vida, Crecimiento y Aprendizaje.",
            "home.discovery_views": "Vistas de descubrimiento",
            "home.discovery_description": "La fuente, el mapa y la lista están unificados por contexto de búsqueda por persona.",
            "home.discovery_feed": "Noticias",
            "home.discovery_map": "Mapa",
            "home.discovery_list": "Lista",
            "home.discovery_alerts": "Alertas",
            "home.saved_alert_example": "Alerta guardada de ejemplo: plomero por menos de $150 en Springfield",
            "home.customer_transactions": "Transacciones del cliente",
            "home.sync_live_data": "Sincronizar datos en vivo",
            "home.syncing": "Sincronizando...",
            "home.last_sync": "Última sincronización:",
            "home.refreshes_customer_data": "Actualiza trabajos, ofertas, asistentes, citas y alquileres desde",
            "home.loading_jobs": "Cargando sus trabajos…",
            "home.loading_bookings": "Cargando reservas…",
            "home.loading_rental_tools": "Cargando herramientas de alquiler…",
            "home.saved_search_alerts": "Alertas de búsqueda guardadas",
            "home.create_alert_query": "Crear alerta",
            "home.add": "Agregar",
            "home.map_view": "Vista de mapa",
            "home.refresh_map_for_active_persona": "Actualizar mapa para persona activa",
            "home.trust_and_safety": "Confianza y seguridad",
            "home.stop_safety_timer": "Detener temporizador de seguridad",
            "home.start_safety_timer": "Iniciar temporizador de seguridad",
            "home.sos": "SOS",
            "home.sos_triggered": "SOS activado: ubicación + registro de incidente en cola.",
            "home.two_way_reviews": "Reseñas bidireccionales",
            "home.from": "De",
            "home.customer": "Cliente",
            "home.helper": "Ayudante",
            "home.business_owner": "Propietario de negocio",
            "home.to": "Para",
            "home.rating": "Calificación",
            "home.review_comment": "Comentario de reseña",
            "home.submit_review": "Enviar reseña",
            "home.loading_jobs_near_you": "Cargando trabajos cercanos…",
            "home.customer_job_posting": "Publicación de trabajo",
            "home.bids_comparison": "Ofertas + Comparación",
            "home.customer_service_booking": "Reserva de servicio",
            "home.tool_rental_flow": "Flujo de alquiler de herramientas",
            "home.save_draft": "Guardar borrador",
            "home.publish_job": "Publicar trabajo + notificar",
            "home.load_more_jobs": "Cargar más trabajos",
            "home.load_more_bookings": "Cargar más reservas",
            "home.load_more_rentals": "Cargar más alquileres",
            "home.loading": "Cargando...",
            "home.sync_pending_changes": "cambio(s) esperando para sincronizar.",
            "home.search_placeholder": "Buscar trabajos, ayudantes, herramientas, formación, financiación",
            "home.run_today_build_tomorrow": "Corre hoy. Construye mañana.",
            "home.one_account_many_personas": "Una cuenta. Muchas personas. Las actualizaciones son instantáneas.",
            "home.persona": "Persona:",
            "home.role": "Rol:",
            "home.profile_settings": "Perfil y configuración",
            "home.select_business": "Seleccionar negocio",
            "home.job_title": "Título del trabajo",
            "home.category": "Categoría",
            "home.category_plumbing": "Fontanería",
            "home.category_electrical": "Electricidad",
            "home.category_hvac": "HVAC",
            "home.category_carpentry": "Carpintería",
            "home.category_cleaning": "Limpieza",
            "home.location_autocomplete": "Autocompletar ubicación",
            "home.address": "Dirección",
            "home.describe_work": "Describe el trabajo",
            "home.add_photos": "Agregar fotos (hasta 5)",
            "home.uploading_photos": "Subiendo fotos…",
            "home.publishing_job": "Publicando trabajo…",
            "home.retry": "Reintentar",
            "home.publish": "Publicar",
            "home.start": "Comenzar",
            "home.complete": "Completar",
            "home.cancel": "Cancelar",
            "home.post_job_for_bids": "Publica un trabajo para comenzar a recibir ofertas.",
            "home.job_picker": "Trabajo",
            "home.sort": "Ordenar",
            "home.price_low_to_high": "Precio bajo→alto",
            "home.price_high_to_low": "Precio alto→bajo",
            "home.helper_a_to_z": "Ayudante A→Z",
            "home.accepted": "Aceptado",
            "home.accept_create_appointment": "Aceptar + Crear cita",
            "home.message": "Mensaje",
            "home.message_default_content": "¿Puedes confirmar el alcance y el cronograma?",
            "home.message_helper": "Mensaje para el ayudante",
            "home.refreshing_bids": "Actualizando ofertas…",
            "home.retry_bid_sync": "Reintentar sincronización de ofertas",
            "home.search_helpers": "Buscar ayudantes",
            "home.min_rating": "Calificación mínima:",
            "home.availability": "Disponibilidad:",
            "home.service_type": "Tipo de servicio",
            "home.date": "Fecha",
            "home.time_slot": "Franja horaria",
            "home.payment_authorization": "Autorización de pago",
            "home.pre_appointment_message": "Mensaje previo a la cita",
            "home.book_service": "Reservar servicio",
            "home.creating_booking": "Creando reserva…",
            "home.payment_prefix": "Pago:",
            "home.payment_authorized": "autorizado",
            "home.payment_pending": "pendiente",
            "home.post_appointment_message": "Mensaje posterior a la cita",
            "home.confirm_payment": "Confirmar pago",
            "home.send_update": "Enviar actualización",
            "home.cancel_booking": "Cancelar reserva",
            "home.review_note": "Nota de revisión",
            "home.retry_booking_sync": "Reintentar sincronización de reservas",
            "home.search_tool_rentals": "Buscar alquileres de herramientas",
            "home.max_daily_rate": "Tarifa máxima diaria:",
            "home.tool_picker": "Herramienta",
            "home.terms": "Términos:",
            "home.available": "Disponible:",
            "home.reservation_slot": "Franja de reserva",
            "home.reserve_tool": "Reservar herramienta",
            "home.reserving_tool": "Reservando herramienta…",
            "home.deposit": "Depósito:",
            "home.dispute": "Disputa:",
            "home.pickup": "Recoger",
            "home.return": "Devolver",
            "home.resolve_dispute": "Resolver disputa",
            "home.open_dispute": "Abrir disputa",
            "home.damage_assessment": "Evaluación de daños",
            "home.save_damage_notes": "Guardar notas de daño",
            "home.retry_rental_sync": "Reintentar sincronización de alquileres",
            "settings.active_persona": "Perfil activo",
            "settings.persona": "Perfil",
            "settings.business": "Negocio",
            "settings.choose_business": "Elegir negocio",
            "settings.language_localization": "Idioma y localización",
            "settings.display_privacy": "Pantalla y privacidad",
            "settings.availability_manager": "Disponibilidad",
            "settings.account_recovery_export": "Recuperación y exportación",
            "settings.request_data_export": "Solicitar exportación de datos",
            "settings.request_account_deletion": "Solicitar eliminación de cuenta",
            "settings.notification_preferences_persona": "Preferencias de notificación por perfil",
            "settings.app_api": "API de la app"
            ,"profile.sub_role": "Sub-role"
            ,"profile.assigned_role": "Rol asignado"
            ,"profile.selected_business": "Negocio seleccionado"
            ,"profile.no_business_selected": "No se seleccionó negocio"
            ,"profile.locale": "Configuración regional"
            ,"profile.layout_direction": "Dirección de diseño"
            ,"profile.layout_rtl": "Derecha a izquierda"
            ,"profile.layout_ltr": "Izquierda a derecha"
            ,"profile.security_section": "Seguridad"
            ,"profile.auto_translate_previews": "Traducción automática de vistas previas"
            ,"profile.recovery_snapshot_ready": "La instantánea de recuperación está lista para restaurar en un nuevo dispositivo."
            ,"profile.recovery_snapshot_not_ready": "La instantánea de recuperación no está lista."
            ,"profile.export_request_queued": "La solicitud de exportación fue enviada."
            ,"profile.account_deletion_submitted": "La solicitud de eliminación de cuenta fue enviada."
            ,"settings.language": "Idioma"
            ,"settings.appearance": "Apariencia"
            ,"settings.large_text_mode": "Texto grande"
            ,"settings.privacy_mode": "Modo privacidad (ocultar valores sensibles)"
            ,"settings.analytics_signals": "Permitir señales analíticas"
            ,"settings.persona": "Persona"
            ,"settings.alerts": "alertas"
            ,"settings.radius": "Radio"
            ,"settings.miles": "millas"
            ,"settings.quiet_hours": "Horas tranquilas"
            ,"settings.api_base_url": "URL base de API"
            ,"settings.active": "Activo"
            ,"settings.save_api_url": "Guardar URL de API"
            ,"settings.test_connection": "Probar conexión"
            ,"settings.probe_auth_endpoints": "Probar endpoints de autenticación"
            ,"settings.syncing": "Sincronizando..."
            ,"settings.sync_now": "Sincronizar ahora"
            ,"shop.growth_title": "Crecimiento"
            ,"shop.economic_mobility_ladder": "Escalera de movilidad económica"
            ,"shop.ladder_path": "Habilidad → Ingreso secundario → Negocio con licencia → Operación a escala"
            ,"shop.next_step": "Siguiente paso:"
            ,"shop.business_ascension": "Ascenso empresarial"
            ,"shop.business_ascension_detail": "Solicita pasar de trabajos secundarios a operación con licencia."
            ,"shop.community_wholesale_groups": "Grupos de compras al por mayor comunitarios"
            ,"shop.community_wholesale_groups_detail": "Únete a campañas de compra masiva del vecindario."
            ,"shop.financing_prequalification": "Pre-calificación de financiamiento"
            ,"shop.financing_prequalification_detail": "Microcréditos, equipos y rutas de financiamiento inicial."
            ,"shop.grants_and_subsidies": "Subvenciones y ayudas"
            ,"shop.grants_and_subsidies_detail": "Oportunidades para tu oficio según la ubicación."
            ,"shop.business_ascension_application": "Solicitud de ascenso empresarial"
            ,"shop.full_name": "Nombre completo"
            ,"shop.current_skill": "Habilidad actual"
            ,"shop.target_license_business": "Licencia/negocio objetivo"
            ,"shop.submit_ascension_application": "Enviar solicitud de ascenso empresarial"
            ,"shop.status_label": "Estado:"
            ,"shop.ascension_status_not_started": "Iniciar solicitud de ascenso empresarial"
            ,"shop.ascension_status_submitted": "Completa los cursos de aprendizaje para tu ruta de licencia"
            ,"shop.ascension_status_financing_pending": "Enviar pre-calificación de financiamiento"
            ,"shop.ascension_status_default": "Unirse a un grupo mayorista y ejecutar la primera operación escalada"
            ,"shop.community_wholesale_groups_header": "Grupos de compras al por mayor comunitarios"
            ,"shop.join": "Unirse"
            ,"shop.joined": "Unido"
            ,"shop.requested_amount": "Monto solicitado"
            ,"shop.purpose": "Propósito"
            ,"shop.monthly_revenue": "Ingresos mensuales"
            ,"shop.credit_band": "Banda de crédito"
            ,"shop.credit_fair": "Aceptable"
            ,"shop.credit_good": "Bueno"
            ,"shop.credit_very_good": "Muy bueno"
            ,"shop.submit_prequalification": "Enviar pre-calificación"
            ,"shop.apply": "Solicitar"
            ,"shop.progress_tracker": "Seguimiento de progreso"
            ,"shop.progress_step_skill": "Habilidad"
            ,"shop.progress_step_side_income": "Ingreso secundario"
            ,"shop.progress_step_licensed_business": "Negocio con licencia"
            ,"shop.progress_step_scaled_operation": "Operación escalada"
            ,"shop.current_step": "Paso actual"
            ,"shop.tax_document_center": "Centro de documentos fiscales"
            ,"shop.tax_document_description": "Resumen anual estilo 1099 y seguimiento de deducciones."
            ,"shop.tax_year": "Año fiscal"
            ,"shop.gross": "Bruto"
            ,"shop.deductions": "Deducciones"
            ,"shop.voice_input": "Entrada de voz"
            ,"shop.voice_input_enable_label": "Habilitar entrada de voz para publicar y chatear"
            ,"shop.voice_input_description": "La ruta de dictado consciente del idioma sigue el idioma de la app seleccionado."
            ,"shop.live_growth_data": "Datos de crecimiento en vivo"
            ,"shop.sync_live_data": "Sincronizar datos en vivo"
            ,"shop.wallet": "Billetera"
            ,"shop.available": "Disponible"
            ,"shop.pending_escrow": "Depósito pendiente"
            ,"shop.payout_method": "Método de pago"
            ,"shop.update_payout_method": "Actualizar método de pago"
            ,"shop.save_payout_method": "Guardar método de pago"
            ,"shop.transaction_history": "Historial de transacciones"
            ,"shop.transaction_title": "Título de transacción"
            ,"shop.amount": "Importe"
            ,"shop.credit": "Crédito"
            ,"shop.add_transaction": "Agregar transacción"
            ,"shop.consultant_profile_snapshot": "Resumen de perfil de consultor"
            ,"shop.packages_label": "Paquetes: %d"
            ,"shop.appointments_label": "Citas: %d"
            ,"shop.notes_label": "Notas: %d"
            ,"shop.sync_growth_data_hint": "Sincroniza datos en vivo para cargar el perfil del consultor."
            ,"shop.tool_owner_inventory": "Inventario de propietario de herramientas"
            ,"shop.sync_tool_inventory_hint": "Sincroniza datos en vivo para cargar el inventario."
            ,"shop.available_prefix": "Disponible:"
            ,"shop.pending_returns": "Devoluciones pendientes"
            ,"shop.quote_builder": "Constructor de cotizaciones"
            ,"shop.customer_name": "Nombre del cliente"
            ,"shop.labor_amount": "Monto de mano de obra"
            ,"shop.material_amount": "Monto de materiales"
            ,"shop.quote_notes": "Notas"
            ,"shop.save_quote_draft": "Guardar borrador de cotización"
            ,"shop.recurring_services": "Servicios recurrentes"
            ,"shop.service_title": "Título del servicio"
            ,"shop.frequency": "Frecuencia"
            ,"shop.frequency_weekly": "Semanal"
            ,"shop.frequency_bi_weekly": "Quincenal"
            ,"shop.frequency_monthly": "Mensual"
            ,"shop.frequency_label_next_date": "Próxima fecha"
            ,"shop.create_plan": "Crear plan"
            ,"shop.status_active": "Activo"
            ,"shop.status_paused": "En pausa"
            ,"shop.financing_status_not_started": "No iniciado"
            ,"shop.financing_status_submitted": "Presentado"
            ,"shop.pause": "Pausar"
            ,"shop.resume": "Reanudar"
        ],
        .french: [
            "app.name": "OxSteed One",
            "auth.title": "Un compte. Plusieurs rôles.",
            "auth.subtitle": "Connectez-vous pour charger vos profils, messages et transactions.",
            "auth.sign_in": "Se connecter",
            "auth.create_account": "Créer un compte",
            "auth.welcome_back": "Bon retour",
            "auth.full_legal_name": "Nom légal complet",
            "auth.email": "E-mail",
            "auth.password": "Mot de passe",
            "auth.first_name": "Prénom",
            "auth.last_name": "Nom",
            "auth.persona": "Persona",
            "common.done": "Terminé",
            "onboarding.welcome": "Bienvenue",
            "onboarding.welcome_description": "Configurez votre première persona et vos piliers de pulsation. La pulsation n'est jamais nulle au premier lancement.",
            "onboarding.pulse_pillars": "Piliers de pulsation",
            "onboarding.pillar_money": "Argent",
            "onboarding.pillar_home_care": "Entretien de la maison",
            "onboarding.pillar_car_care": "Entretien auto",
            "onboarding.pillar_personal_care": "Soins personnels",
            "onboarding.pillar_goals": "Objectifs",
            "onboarding.pillar_planned_needs": "Besoins planifiés",
            "onboarding.finish_setup": "Terminer la configuration",
            "onboarding.get_started": "Commencer",
            "home.guest_section_open_jobs": "Missions ouvertes",
            "home.guest_section_available_helpers": "Aides disponibles",
            "home.guest_section_tool_rentals": "Location d'outils",
            "home.guest_section_open_jobs_subtitle": "Consultez les besoins clients en direct avant de rejoindre comme aide.",
            "home.guest_section_available_helpers_subtitle": "Trouvez des prestataires locaux et comparez les signaux de confiance.",
            "home.guest_section_tool_rentals_subtitle": "Parcourez les outils à proximité avant de réserver.",
            "home.browse_help_jobs_tools": "Parcourir l'aide locale, les missions et les outils",
            "home.search_placeholder_text": "Rechercher des missions, aides ou outils",
            "home.guest_section_jobs": "Missions",
            "home.guest_section_helpers": "Aides",
            "home.guest_section_tools": "Outils",
            "home.guest_empty_state_title": "Aucune annonce publique correspondante",
            "home.guest_empty_state_body": "Essayez une recherche différente ou rafraîchissez les annonces publiques.",
            "home.location_local_area": "Zone locale",
            "home.rating_label": "Évaluation",
            "home.rating_stars": "étoiles.",
            "home.rate_prefix": "À partir de",
            "guest.item_detail_job_prompt": "Connectez-vous pour envoyer un message, faire une offre ou gérer cette mission.",
            "guest.action_view_job": "Connectez-vous pour voir la mission",
            "guest.action_book": "Connectez-vous pour réserver",
            "guest.action_reserve_prompt": "Connectez-vous pour réserver, coordonner la remise et protéger votre dépôt.",
            "guest.action_reserve": "Connectez-vous pour réserver",
            "profile.settings": "Paramètres",
            "profile.security": "Sécurité",
            "profile.communication": "Communication",
            "profile.push_title": "Notifications Push",
            "profile.push_enable": "Activer les notifications Push",
            "profile.sign_out": "Se déconnecter",
            "force_update.title": "Mise à jour requise",
            "force_update.body": "Veuillez mettre à jour OxSteed One pour continuer.",
            "lock.title": "OxSteed One verrouillé",
            "lock.button": "Déverrouiller avec Face ID / Touch ID",
            "sync.offline": "Mode hors ligne",
            "sync.pending": "Synchronisation en attente",
            "sync.button": "Synchroniser",
            "sync.offline_detail": "Les modifications sont enregistrées localement et seront synchronisées lorsque la connexion revient.",
            "home.title": "Accueil",
            "home.universal_search": "Recherche universelle",
            "home.universal_search_note": "Les alertes enregistrées et superpositions de carte arriveront ensuite.",
            "home.search_results": "Résultats de la recherche",
            "home.no_search_results": "Aucun résultat dans Accueil, Vie, Croissance ou Apprentissage.",
            "home.discovery_views": "Vues de découverte",
            "home.discovery_description": "Flux, carte et liste sont unifiés selon le contexte de recherche par persona.",
            "home.discovery_feed": "Flux",
            "home.discovery_map": "Carte",
            "home.discovery_list": "Liste",
            "home.discovery_alerts": "Alertes",
            "home.saved_alert_example": "Exemple d'alerte sauvegardée : plombier à moins de 150 $ à Springfield",
            "home.customer_transactions": "Transactions client",
            "home.sync_live_data": "Synchroniser données en direct",
            "home.syncing": "Synchronisation...",
            "home.last_sync": "Dernière synchronisation :",
            "home.refreshes_customer_data": "Actualise les missions, offres, aides, rendez-vous et locations depuis",
            "home.loading_jobs": "Chargement de vos missions…",
            "home.loading_bookings": "Chargement des réservations…",
            "home.loading_rental_tools": "Chargement des outils de location…",
            "home.saved_search_alerts": "Alertes de recherche sauvegardées",
            "home.create_alert_query": "Créer une alerte",
            "home.add": "Ajouter",
            "home.map_view": "Vue carte",
            "home.refresh_map_for_active_persona": "Actualiser la carte de la persona active",
            "home.trust_and_safety": "Confiance et sécurité",
            "home.stop_safety_timer": "Arrêter minuteur de sécurité",
            "home.start_safety_timer": "Démarrer minuteur de sécurité",
            "home.sos": "SOS",
            "home.sos_triggered": "SOS déclenché : emplacement + journal d'incident en attente.",
            "home.two_way_reviews": "Évaluations bidirectionnelles",
            "home.from": "De",
            "home.customer": "Client",
            "home.helper": "Aide",
            "home.business_owner": "Propriétaire d'entreprise",
            "home.to": "À",
            "home.rating": "Évaluation",
            "home.review_comment": "Commentaire de révision",
            "home.submit_review": "Soumettre l'avis",
            "home.loading_jobs_near_you": "Chargement des missions à proximité…",
            "home.customer_job_posting": "Publication de mission",
            "home.bids_comparison": "Offres + Comparaison",
            "home.customer_service_booking": "Réservation de service",
            "home.tool_rental_flow": "Location d'outils",
            "home.save_draft": "Enregistrer le brouillon",
            "home.publish_job": "Publier la mission + notifier",
            "home.load_more_jobs": "Charger plus de missions",
            "home.load_more_bookings": "Charger plus de réservations",
            "home.load_more_rentals": "Charger plus de locations",
            "home.loading": "Chargement...",
            "home.sync_pending_changes": "modification(s) en attente de synchronisation.",
            "home.search_placeholder": "Rechercher des missions, aides, outils, formation, financement",
            "home.run_today_build_tomorrow": "Avancez aujourd'hui. Construisez demain.",
            "home.one_account_many_personas": "Un compte. Plusieurs personas. Mise à jour instantanée.",
            "home.persona": "Persona :",
            "home.role": "Rôle :",
            "home.profile_settings": "Profil et paramètres",
            "home.select_business": "Sélectionner une entreprise",
            "home.job_title": "Titre de la mission",
            "home.category": "Catégorie",
            "home.category_plumbing": "Plomberie",
            "home.category_electrical": "Électricité",
            "home.category_hvac": "CVC",
            "home.category_carpentry": "Menuiserie",
            "home.category_cleaning": "Nettoyage",
            "home.location_autocomplete": "Compléter automatiquement le lieu",
            "home.address": "Adresse",
            "home.describe_work": "Décrire le travail",
            "home.add_photos": "Ajouter des photos (jusqu'à 5)",
            "home.uploading_photos": "Téléversement des photos…",
            "home.publishing_job": "Publication de la mission…",
            "home.retry": "Réessayer",
            "home.publish": "Publier",
            "home.start": "Démarrer",
            "home.complete": "Terminer",
            "home.cancel": "Annuler",
            "home.post_job_for_bids": "Publiez une mission pour recevoir des offres.",
            "home.job_picker": "Mission",
            "home.sort": "Trier",
            "home.price_low_to_high": "Prix bas→haut",
            "home.price_high_to_low": "Prix haut→bas",
            "home.helper_a_to_z": "Aide A→Z",
            "home.accepted": "Accepté",
            "home.accept_create_appointment": "Accepter + créer un rendez-vous",
            "home.message": "Message",
            "home.message_default_content": "Pouvez-vous confirmer le périmètre et le calendrier ?",
            "home.message_helper": "Message au helper",
            "home.refreshing_bids": "Actualisation des offres…",
            "home.retry_bid_sync": "Réessayer la synchronisation des offres",
            "home.search_helpers": "Rechercher des aides",
            "home.min_rating": "Note min :",
            "home.availability": "Disponibilité :",
            "home.service_type": "Type de service",
            "home.date": "Date",
            "home.time_slot": "Créneau horaire",
            "home.payment_authorization": "Autorisation de paiement",
            "home.pre_appointment_message": "Message avant rendez-vous",
            "home.book_service": "Réserver un service",
            "home.creating_booking": "Création de réservation…",
            "home.payment_prefix": "Paiement :",
            "home.payment_authorized": "autorisé",
            "home.payment_pending": "en attente",
            "home.post_appointment_message": "Message après rendez-vous",
            "home.confirm_payment": "Confirmer le paiement",
            "home.send_update": "Envoyer une mise à jour",
            "home.cancel_booking": "Annuler la réservation",
            "home.review_note": "Note d'évaluation",
            "home.retry_booking_sync": "Réessayer la synchronisation des réservations",
            "home.search_tool_rentals": "Rechercher des locations d'outils",
            "home.max_daily_rate": "Taux quotidien max :",
            "home.tool_picker": "Outil",
            "home.terms": "Conditions :",
            "home.available": "Disponible :",
            "home.reservation_slot": "Créneau de réservation",
            "home.reserve_tool": "Réserver l'outil",
            "home.reserving_tool": "Réservation de l'outil…",
            "home.deposit": "Caution :",
            "home.dispute": "Litige :",
            "home.pickup": "Récupérer",
            "home.return": "Retourner",
            "home.resolve_dispute": "Résoudre le litige",
            "home.open_dispute": "Ouvrir un litige",
            "home.damage_assessment": "Évaluation des dégâts",
            "home.save_damage_notes": "Enregistrer les notes de dégâts",
            "home.retry_rental_sync": "Réessayer la synchronisation des locations",
            "settings.active_persona": "Persona actif",
            "settings.persona": "Persona",
            "settings.business": "Entreprise",
            "settings.choose_business": "Choisir l'entreprise",
            "settings.language_localization": "Langue et localisation",
            "settings.display_privacy": "Affichage et confidentialité",
            "settings.availability_manager": "Disponibilité",
            "settings.account_recovery_export": "Récupération et export",
            "settings.request_data_export": "Demander l'export des données",
            "settings.request_account_deletion": "Demander la suppression du compte",
            "settings.notification_preferences_persona": "Préférences de notification par persona",
            "settings.app_api": "API de l'app"
            ,"profile.sub_role": "Sous-rôle"
            ,"profile.assigned_role": "Rôle attribué"
            ,"profile.selected_business": "Entreprise sélectionnée"
            ,"profile.no_business_selected": "Aucune entreprise sélectionnée"
            ,"profile.locale": "Paramètres régionaux"
            ,"profile.layout_direction": "Sens de l'interface"
            ,"profile.layout_rtl": "Droite à gauche"
            ,"profile.layout_ltr": "Gauche à droite"
            ,"profile.security_section": "Sécurité"
            ,"profile.auto_translate_previews": "Traduire automatiquement les aperçus"
            ,"profile.recovery_snapshot_ready": "La sauvegarde de récupération est prête à restaurer sur un nouvel appareil."
            ,"profile.recovery_snapshot_not_ready": "La sauvegarde de récupération n'est pas prête."
            ,"profile.export_request_queued": "La demande d'export est en file d'attente."
            ,"profile.account_deletion_submitted": "La demande de suppression du compte a été envoyée."
            ,"settings.language": "Langue"
            ,"settings.appearance": "Apparence"
            ,"settings.large_text_mode": "Grand texte"
            ,"settings.privacy_mode": "Mode confidentialité (masquer les données sensibles)"
            ,"settings.analytics_signals": "Autoriser les signaux analytiques"
            ,"settings.persona": "Persona"
            ,"settings.alerts": "alertes"
            ,"settings.radius": "Rayon"
            ,"settings.miles": "miles"
            ,"settings.quiet_hours": "Heures calmes"
            ,"settings.api_base_url": "URL de base de l'API"
            ,"settings.active": "Actif"
            ,"settings.save_api_url": "Enregistrer l'URL de l'API"
            ,"settings.test_connection": "Tester la connexion"
            ,"settings.probe_auth_endpoints": "Tester les endpoints d'auth"
            ,"settings.syncing": "Synchronisation..."
            ,"settings.sync_now": "Synchroniser maintenant"
            ,"shop.growth_title": "Croissance"
            ,"shop.economic_mobility_ladder": "Échelle de mobilité économique"
            ,"shop.ladder_path": "Compétence → Revenu complémentaire → Entreprise agréée → Opération à grande échelle"
            ,"shop.next_step": "Étape suivante :"
            ,"shop.business_ascension": "Progression entrepreneuriale"
            ,"shop.business_ascension_detail": "Demandez le passage du travail annexe à l’activité agréée."
            ,"shop.community_wholesale_groups": "Groupes d'achat en gros communautaires"
            ,"shop.community_wholesale_groups_detail": "Rejoignez les campagnes d'achats groupés du voisinage."
            ,"shop.financing_prequalification": "Pré-qualification de financement"
            ,"shop.financing_prequalification_detail": "Micro-prêts, équipement, et parcours de financement pour démarrer."
            ,"shop.grants_and_subsidies": "Subventions et aides"
            ,"shop.grants_and_subsidies_detail": "Opportunités liées à votre métier selon la localisation."
            ,"shop.business_ascension_application": "Demande de progression entrepreneuriale"
            ,"shop.full_name": "Nom complet"
            ,"shop.current_skill": "Compétence actuelle"
            ,"shop.target_license_business": "Licence/activité cible"
            ,"shop.submit_ascension_application": "Soumettre la demande de progression"
            ,"shop.status_label": "Statut :"
            ,"shop.ascension_status_not_started": "Démarrer la demande de progression entrepreneuriale"
            ,"shop.ascension_status_submitted": "Terminez les cours d'apprentissage de votre parcours de licence"
            ,"shop.ascension_status_financing_pending": "Soumettre la pré-qualification de financement"
            ,"shop.ascension_status_default": "Rejoindre un groupe de gros et lancer la première opération à grande échelle"
            ,"shop.community_wholesale_groups_header": "Groupes d'achat en gros communautaires"
            ,"shop.join": "Rejoindre"
            ,"shop.joined": "Rejoint"
            ,"shop.requested_amount": "Montant demandé"
            ,"shop.purpose": "Objet"
            ,"shop.monthly_revenue": "Revenu mensuel"
            ,"shop.credit_band": "Niveau de crédit"
            ,"shop.credit_fair": "Correct"
            ,"shop.credit_good": "Bon"
            ,"shop.credit_very_good": "Très bon"
            ,"shop.submit_prequalification": "Soumettre la pré-qualification"
            ,"shop.apply": "Postuler"
            ,"shop.progress_tracker": "Suivi de progression"
            ,"shop.progress_step_skill": "Compétence"
            ,"shop.progress_step_side_income": "Revenu complémentaire"
            ,"shop.progress_step_licensed_business": "Entreprise agréée"
            ,"shop.progress_step_scaled_operation": "Opération à grande échelle"
            ,"shop.current_step": "Étape actuelle"
            ,"shop.tax_document_center": "Centre de documents fiscaux"
            ,"shop.tax_document_description": "Résumé annuel style 1099 et suivi des déductions."
            ,"shop.tax_year": "Année fiscale"
            ,"shop.gross": "Brut"
            ,"shop.deductions": "Déductions"
            ,"shop.voice_input": "Entrée vocale"
            ,"shop.voice_input_enable_label": "Activer la saisie vocale pour publier et discuter"
            ,"shop.voice_input_description": "Le chemin de dictée bilingue suit la langue d'application sélectionnée."
            ,"shop.live_growth_data": "Données de croissance en direct"
            ,"shop.sync_live_data": "Synchroniser les données en direct"
            ,"shop.wallet": "Portefeuille"
            ,"shop.available": "Disponible"
            ,"shop.pending_escrow": "Dépôt en attente"
            ,"shop.payout_method": "Méthode de versement"
            ,"shop.update_payout_method": "Mettre à jour la méthode de versement"
            ,"shop.save_payout_method": "Enregistrer la méthode de versement"
            ,"shop.transaction_history": "Historique des transactions"
            ,"shop.transaction_title": "Titre de la transaction"
            ,"shop.amount": "Montant"
            ,"shop.credit": "Crédit"
            ,"shop.add_transaction": "Ajouter une transaction"
            ,"shop.consultant_profile_snapshot": "Résumé du profil du consultant"
            ,"shop.packages_label": "Forfaits : %d"
            ,"shop.appointments_label": "Rendez-vous : %d"
            ,"shop.notes_label": "Remarques : %d"
            ,"shop.sync_growth_data_hint": "Synchronisez les données en direct pour charger le profil du consultant."
            ,"shop.tool_owner_inventory": "Inventaire du propriétaire d'outils"
            ,"shop.sync_tool_inventory_hint": "Synchronisez les données en direct pour charger l'inventaire."
            ,"shop.available_prefix": "Disponible :"
            ,"shop.pending_returns": "Retours en attente"
            ,"shop.quote_builder": "Créateur de devis"
            ,"shop.customer_name": "Nom du client"
            ,"shop.labor_amount": "Montant de main-d'œuvre"
            ,"shop.material_amount": "Montant des matériaux"
            ,"shop.quote_notes": "Notes"
            ,"shop.save_quote_draft": "Enregistrer le brouillon de devis"
            ,"shop.recurring_services": "Services récurrents"
            ,"shop.service_title": "Titre du service"
            ,"shop.frequency": "Fréquence"
            ,"shop.frequency_weekly": "Hebdomadaire"
            ,"shop.frequency_bi_weekly": "Bimensuel"
            ,"shop.frequency_monthly": "Mensuel"
            ,"shop.frequency_label_next_date": "Date suivante"
            ,"shop.create_plan": "Créer un plan"
            ,"shop.status_active": "Actif"
            ,"shop.status_paused": "En pause"
            ,"shop.financing_status_not_started": "Pas commencé"
            ,"shop.financing_status_submitted": "Présenté"
            ,"shop.pause": "Pause"
            ,"shop.resume": "Reprendre"
        ],
        .haitianCreole: [
            "app.name": "OxSteed One",
            "auth.title": "Yon kont. Anpil wòl.",
            "auth.subtitle": "Konekte pou chaje pwofil, mesaj, ak tranzaksyon ou yo.",
            "auth.sign_in": "Konekte",
            "auth.create_account": "Kreye kont",
            "auth.welcome_back": "Byen vini",
            "auth.full_legal_name": "Non legal konplè",
            "auth.email": "Imèl",
            "auth.password": "Modpas",
            "auth.first_name": "Non",
            "auth.last_name": "Siyati",
            "auth.persona": "Persona",
            "common.done": "Fini",
            "onboarding.welcome": "Byenveni",
            "onboarding.welcome_description": "Mete premye pèsonn ou ansanm epi mete poto kè ou yo. Poto a pa janm rete zewo nan premye lansman an.",
            "onboarding.pulse_pillars": "Poto Pulse",
            "onboarding.pillar_money": "Lajan",
            "onboarding.pillar_home_care": "Swen lakay",
            "onboarding.pillar_car_care": "Swen machin",
            "onboarding.pillar_personal_care": "Swen pèsonèl",
            "onboarding.pillar_goals": "Objektif",
            "onboarding.pillar_planned_needs": "Bezwen planifye",
            "onboarding.finish_setup": "Fini enstalasyon",
            "onboarding.get_started": "Kòmanse",
            "home.guest_section_open_jobs": "Travay ouvè",
            "home.guest_section_available_helpers": "Ede ki disponib",
            "home.guest_section_tool_rentals": "Lwe zouti",
            "home.guest_section_open_jobs_subtitle": "Wè bezwen kliyan yo an dirèk anvan ou rantre kòm yon ede.",
            "home.guest_section_available_helpers_subtitle": "Jwenn founisè sèvis lokal epi konpare siy konfyans yo.",
            "home.guest_section_tool_rentals_subtitle": "Gade zouti ki tou pre anvan ou fè rezèvasyon.",
            "home.browse_help_jobs_tools": "Gade èd lokal, travay, ak zouti",
            "home.search_placeholder_text": "Chèche travay, èd, oswa zouti",
            "home.guest_section_jobs": "Travay",
            "home.guest_section_helpers": "Ede",
            "home.guest_section_tools": "Zouti",
            "home.guest_empty_state_title": "Pa gen okenn lis piblik ki koresponn",
            "home.guest_empty_state_body": "Eseye yon lòt rechèch oswa renouvle lis piblik yo.",
            "home.location_local_area": "Zòn lokal",
            "home.rating_label": "Evalyasyon",
            "home.rating_stars": "etwal.",
            "home.rate_prefix": "Depi",
            "guest.item_detail_job_prompt": "Konekte pou w voye mesaj, fè yon òf, oswa jere travay sa a.",
            "guest.action_view_job": "Konekte pou wè travay la",
            "guest.action_book": "Konekte pou fè rezèvasyon",
            "guest.action_reserve_prompt": "Konekte pou fè rezèvasyon, kowòdone pran livrezon an, epi pwoteje depo ou.",
            "guest.action_reserve": "Konekte pou fè rezèvasyon",
            "profile.settings": "Paramèt",
            "profile.security": "Sekirite",
            "profile.communication": "Kominikasyon",
            "profile.push_title": "Notifikasyon Push",
            "profile.push_enable": "Aktive notifikasyon Push",
            "profile.sign_out": "Dekonekte",
            "force_update.title": "Mizajou obligatwa",
            "force_update.body": "Tanpri mete ajou OxSteed One pou kontinye.",
            "lock.title": "OxSteed One fèmen",
            "lock.button": "Degaje ak Face ID / Touch ID",
            "sync.offline": "Mòd offline",
            "sync.pending": "Senkronizasyon an atant",
            "sync.button": "Senkronize",
            "sync.offline_detail": "Chanjman yo sere lokalman e yo pral senkronize lè koneksyon retounen.",
            "home.title": "Lakou",
            "home.universal_search": "Rechèch inivèsèl",
            "home.universal_search_note": "Alèt rechèch ki anrejistre ak kouch kat yo ap vini nan pwochen etap yo.",
            "home.search_results": "Rezilta rechèch",
            "home.no_search_results": "Pa gen okenn korespondans nan Lakay, Lavi, Kwasans ak Aprantisaj.",
            "home.discovery_views": "Gade Dekouvèt",
            "home.discovery_description": "Fil, kat, epi lis ini selon kontèks rechèch pa pèsona.",
            "home.discovery_feed": "Fil",
            "home.discovery_map": "Kat",
            "home.discovery_list": "Lis",
            "home.discovery_alerts": "Alèt",
            "home.saved_alert_example": "Egzanp alèt anrejistre: plonbye anba $150 nan Springfield",
            "home.customer_transactions": "Transaksyon kliyan",
            "home.sync_live_data": "Senkronize done an dirèk",
            "home.syncing": "Senkronize...",
            "home.last_sync": "Dènye senkronizasyon:",
            "home.refreshes_customer_data": "Rafrechi travay, òf, asistan, randevou, ak lwe soti",
            "home.loading_jobs": "Chaje travay ou yo…",
            "home.loading_bookings": "Chaje rezèvasyon yo…",
            "home.loading_rental_tools": "Chaje zouti lwe yo…",
            "home.saved_search_alerts": "Alèt rechèch ki anrejistre",
            "home.create_alert_query": "Kreye alèt rechèch",
            "home.add": "Ajoute",
            "home.map_view": "Gade kat",
            "home.refresh_map_for_active_persona": "Rafrechi kat pou pèsona aktif la",
            "home.trust_and_safety": "Konfyans ak sekirite",
            "home.stop_safety_timer": "Kanpe tanè sekirite",
            "home.start_safety_timer": "Kòmanse tanè sekirite",
            "home.sos": "SOS",
            "home.sos_triggered": "SOS aktive: kote + jounal ensidan an nan ke.",
            "home.two_way_reviews": "Dezyèm revizyon",
            "home.from": "Depi",
            "home.customer": "Kliyan",
            "home.helper": "Ede",
            "home.business_owner": "Mèt biznis",
            "home.to": "Pou",
            "home.rating": "Evalyasyon",
            "home.review_comment": "Kòmantè revizyon",
            "home.submit_review": "Soumèt revizyon",
            "home.loading_jobs_near_you": "Chaje travay ki toupre ou…",
            "home.customer_job_posting": "Pibliye travay kliyan",
            "home.bids_comparison": "Òf + Konparezon",
            "home.customer_service_booking": "Rezèvasyon sèvis kliyan",
            "home.tool_rental_flow": "Lwaye zouti",
            "home.save_draft": "Sove bouyon",
            "home.publish_job": "Pibliye travay + notifye",
            "home.load_more_jobs": "Chaje plis travay",
            "home.load_more_bookings": "Chaje plis rezèvasyon",
            "home.load_more_rentals": "Chaje plis lokasyon",
            "home.loading": "Ap chaje...",
            "home.sync_pending_changes": "chanjman yo ap tann pou senkronize.",
            "home.search_placeholder": "Chèche travay, èd, zouti, fòmasyon, finansman",
            "home.run_today_build_tomorrow": "Kouri jodi a. Bati demen.",
            "home.one_account_many_personas": "Yon kont. Plizyè wòl. Mizajou yo fèt touswit.",
            "home.persona": "Persona:",
            "home.role": "Wòl:",
            "home.profile_settings": "Pwofil & paramèt",
            "home.select_business": "Chwazi biznis",
            "home.job_title": "Tit travay la",
            "home.category": "Kategori",
            "home.category_plumbing": "Plonbi",
            "home.category_electrical": "Elektrik",
            "home.category_hvac": "HVAC",
            "home.category_carpentry": "Kaptenri",
            "home.category_cleaning": "Netwayaj",
            "home.location_autocomplete": "Ranpli otomatik kote a",
            "home.address": "Adrèt",
            "home.describe_work": "Dekri travay la",
            "home.add_photos": "Ajoute foto (jiska 5)",
            "home.uploading_photos": "Ap telechaje foto yo…",
            "home.publishing_job": "Pibliye travay la…",
            "home.retry": "Eseye ankò",
            "home.publish": "Pibliye",
            "home.start": "Kòmanse",
            "home.complete": "Fini",
            "home.cancel": "Anile",
            "home.post_job_for_bids": "Pibliye yon travay pou kòmanse resevwa òf.",
            "home.job_picker": "Travay",
            "home.sort": "Triye",
            "home.price_low_to_high": "Pri ki ba→wo",
            "home.price_high_to_low": "Pri ki wo→ba",
            "home.helper_a_to_z": "Èd A→Z",
            "home.accepted": "Aksepte",
            "home.accept_create_appointment": "Aksepte + Kreye randevou",
            "home.message": "Voye mesaj",
            "home.message_default_content": "Èske ou ka konfime objektif ak delè a?",
            "home.message_helper": "Mesaj pou èd la",
            "home.refreshing_bids": "Ap rafrechi òf yo...",
            "home.retry_bid_sync": "Reyèsye senkronize òf yo",
            "home.search_helpers": "Chèche èd",
            "home.min_rating": "Nòt minimòm:",
            "home.availability": "Disponibilite:",
            "home.service_type": "Tip sèvis",
            "home.date": "Dat",
            "home.time_slot": "Ranje tan",
            "home.payment_authorization": "Otorizasyon peman",
            "home.pre_appointment_message": "Mesaj anvan randevou",
            "home.book_service": "Rezève sèvis",
            "home.creating_booking": "An kreyasyon rezèvasyon...",
            "home.payment_prefix": "Peman:",
            "home.payment_authorized": "otorize",
            "home.payment_pending": "an atant",
            "home.post_appointment_message": "Mesaj apre randevou",
            "home.confirm_payment": "Konfime peman",
            "home.send_update": "Voye aktyalizasyon",
            "home.cancel_booking": "Anile rezèvasyon",
            "home.review_note": "Nòt revizyon",
            "home.retry_booking_sync": "Reyèsye senkronize rezèvasyon",
            "home.search_tool_rentals": "Chèche lwe zouti",
            "home.max_daily_rate": "To chak jou ki maks:",
            "home.tool_picker": "Zouti",
            "home.terms": "Kondisyon:",
            "home.available": "Disponib:",
            "home.reservation_slot": "Ranje rezèvasyon",
            "home.reserve_tool": "Rezève zouti",
            "home.reserving_tool": "An rezève zouti...",
            "home.deposit": "Depo:",
            "home.dispute": "Diskisyon:",
            "home.pickup": "Ranmase",
            "home.return": "Retounen",
            "home.resolve_dispute": "Rezoud diskisyon",
            "home.open_dispute": "Louvri diskisyon",
            "home.damage_assessment": "Evalyasyon domaj",
            "home.save_damage_notes": "Sove nòt domaj",
            "home.retry_rental_sync": "Eseye ankò senkronizasyon lokasyon",
            "settings.active_persona": "Persona aktif",
            "settings.persona": "Persona",
            "settings.business": "Biznis",
            "settings.choose_business": "Chwazi biznis",
            "settings.language_localization": "Lang ak lokalizasyon",
            "settings.display_privacy": "Afiche ak vi prive",
            "settings.availability_manager": "Disponiblite",
            "settings.account_recovery_export": "Rekiperasyon ak ekspòtasyon",
            "settings.request_data_export": "Mande ekspòt done",
            "settings.request_account_deletion": "Mande efase kont",
            "settings.notification_preferences_persona": "Preferans notifikasyon pa persona",
            "settings.app_api": "API aplikasyon an"
            ,"profile.sub_role": "Sib-wòl"
            ,"profile.assigned_role": "Wòl ki asiyen"
            ,"profile.selected_business": "Biznis ki chwazi"
            ,"profile.no_business_selected": "Pa gen biznis ki chwazi"
            ,"profile.locale": "Lokal"
            ,"profile.layout_direction": "Direksyon Layout"
            ,"profile.layout_rtl": "Dwat pou agoch"
            ,"profile.layout_ltr": "Agoch pou dwat"
            ,"profile.security_section": "Sekirite"
            ,"profile.auto_translate_previews": "Tradui preview otomatikman"
            ,"profile.recovery_snapshot_ready": "Sispansyon rekiperasyon an pare pou retabli sou yon nouvo aparèy."
            ,"profile.recovery_snapshot_not_ready": "Snapshot rekiperasyon an poko pare."
            ,"profile.export_request_queued": "Rekèt ekspòt la anrèg."
            ,"profile.account_deletion_submitted": "Rekèt efase kont lan voye."
            ,"settings.language": "Lang"
            ,"settings.appearance": "Aparans"
            ,"settings.large_text_mode": "Tèks gwo"
            ,"settings.privacy_mode": "Mòd vi prive (mask valè sansib)"
            ,"settings.analytics_signals": "Pèmèt siy analiz"
            ,"settings.persona": "Persona"
            ,"settings.alerts": "alèt"
            ,"settings.radius": "Radyis"
            ,"settings.miles": "miles"
            ,"settings.quiet_hours": "Orè trankilite"
            ,"settings.api_base_url": "URL baz API"
            ,"settings.active": "Aktif"
            ,"settings.save_api_url": "Sove URL API"
            ,"settings.test_connection": "Teste koneksyon"
            ,"settings.probe_auth_endpoints": "Teste bout pwen otantifikasyon"
            ,"settings.syncing": "Senkronize..."
            ,"settings.sync_now": "Senkronize kounye a"
            ,"shop.growth_title": "Kwasans"
            ,"shop.economic_mobility_ladder": "Egzalite mobilite ekonomik"
            ,"shop.ladder_path": "Konpetans → Revni sou bò → Biznis ki gen lisans → Operasyon ki elaji"
            ,"shop.next_step": "Pwochen etap:"
            ,"shop.business_ascension": "Leve antreprenarya"
            ,"shop.business_ascension_detail": "Aplike pou pase soti nan travay bò a nan operasyon ki gen lisans."
            ,"shop.community_wholesale_groups": "Gwoup an gwo kominotè"
            ,"shop.community_wholesale_groups_detail": "Antre nan kanpay achte an gwoup nan katye a."
            ,"shop.financing_prequalification": "Pre-kalifikasyon finansman"
            ,"shop.financing_prequalification_detail": "Mikwokredi, ekipman, ak chemen finansman lansman."
            ,"shop.grants_and_subsidies": "Bous ak sibvansyon"
            ,"shop.grants_and_subsidies_detail": "Oportunité selon domèn ou ak kote ou ye."
            ,"shop.business_ascension_application": "Demann leve antreprenarya"
            ,"shop.full_name": "Non konplè"
            ,"shop.current_skill": "Konpetans aktyèl"
            ,"shop.target_license_business": "Lisans oswa biznis sib"
            ,"shop.submit_ascension_application": "Soumèt demann leve antreprenarya"
            ,"shop.status_label": "Estati:"
            ,"shop.ascension_status_not_started": "Kòmanse demann leve antreprenarya"
            ,"shop.ascension_status_submitted": "Ranpli kou Aprantisaj pou chemen lisans ou"
            ,"shop.ascension_status_financing_pending": "Soumèt pre-kalifikasyon finansman"
            ,"shop.ascension_status_default": "Antre nan yon gwoup an gwo epi egzekite premye operasyon elaji a"
            ,"shop.community_wholesale_groups_header": "Gwoup an gwo kominotè"
            ,"shop.join": "Antre"
            ,"shop.joined": "Antre deja"
            ,"shop.requested_amount": "Kantite mande"
            ,"shop.purpose": "Objektif"
            ,"shop.monthly_revenue": "Revni chak mwa"
            ,"shop.credit_band": "Nivo kredi"
            ,"shop.credit_fair": "Fè mwayen"
            ,"shop.credit_good": "Bon"
            ,"shop.credit_very_good": "Trè bon"
            ,"shop.submit_prequalification": "Soumèt pre-kalifikasyon"
            ,"shop.apply": "Aplike"
            ,"shop.progress_tracker": "Swivi pwogrè"
            ,"shop.progress_step_skill": "Konpetans"
            ,"shop.progress_step_side_income": "Revni sou bò"
            ,"shop.progress_step_licensed_business": "Biznis ki gen lisans"
            ,"shop.progress_step_scaled_operation": "Operasyon elaji"
            ,"shop.current_step": "Etap aktyèl"
            ,"shop.tax_document_center": "Sant dokiman fiskal"
            ,"shop.tax_document_description": "Rezime anyèl style 1099 ak suiv dediksyon."
            ,"shop.tax_year": "Ane fiskal"
            ,"shop.gross": "Brut"
            ,"shop.deductions": "Dediksyon"
            ,"shop.voice_input": "Antre vwa"
            ,"shop.voice_input_enable_label": "Aktive antre vwa pou pòs ak chat"
            ,"shop.voice_input_description": "Chemen diksyonè ki adapte ak lang lan swiv lang app la."
            ,"shop.live_growth_data": "Done kwasans an dirèk"
            ,"shop.sync_live_data": "Senkronize done an dirèk"
            ,"shop.wallet": "Bous"
            ,"shop.available": "Disponib"
            ,"shop.pending_escrow": "Depozit an atant"
            ,"shop.payout_method": "Metòd peman"
            ,"shop.update_payout_method": "Mete ajou metòd peman"
            ,"shop.save_payout_method": "Sove metòd peman"
            ,"shop.transaction_history": "Istwa tranzaksyon"
            ,"shop.transaction_title": "Tit tranzaksyon"
            ,"shop.amount": "Kantite"
            ,"shop.credit": "Kredi"
            ,"shop.add_transaction": "Ajoute tranzaksyon"
            ,"shop.consultant_profile_snapshot": "Rezime pwofil konsiltan"
            ,"shop.packages_label": "Pake: %d"
            ,"shop.appointments_label": "Randevou: %d"
            ,"shop.notes_label": "Nòt: %d"
            ,"shop.sync_growth_data_hint": "Senkronize done an dirèk pou chaje pwofil konsiltan an."
            ,"shop.tool_owner_inventory": "Enventè pwopriyetè zouti"
            ,"shop.sync_tool_inventory_hint": "Senkronize done an dirèk pou chaje enventè a."
            ,"shop.available_prefix": "Disponib:"
            ,"shop.pending_returns": "Retounen ki poko fèt"
            ,"shop.quote_builder": "Konstriktè quote"
            ,"shop.customer_name": "Non kliyan an"
            ,"shop.labor_amount": "Lajan pou travay"
            ,"shop.material_amount": "Lajan materyèl"
            ,"shop.quote_notes": "Nòt"
            ,"shop.save_quote_draft": "Sove plan quote"
            ,"shop.recurring_services": "Sèvis regilye"
            ,"shop.service_title": "Tit sèvis"
            ,"shop.frequency": "Frekans"
            ,"shop.frequency_weekly": "Chak semèn"
            ,"shop.frequency_bi_weekly": "De semèn"
            ,"shop.frequency_monthly": "Chak mwa"
            ,"shop.frequency_label_next_date": "Dat pwochen"
            ,"shop.create_plan": "Kreye plan"
            ,"shop.status_active": "Aktif"
            ,"shop.status_paused": "Ankon"
            ,"shop.financing_status_not_started": "Pa kòmanse"
            ,"shop.financing_status_submitted": "Soumèt"
            ,"shop.pause": "Mete sou paus"
            ,"shop.resume": "Reprann"
        ],
        .arabic: [
            "app.name": "OxSteed One",
            "auth.title": "حساب واحد. أدوار كثيرة.",
            "auth.subtitle": "سجل الدخول لتحميل الشخصيات والرسائل والمعاملات الخاصة بك.",
            "auth.sign_in": "تسجيل الدخول",
            "auth.create_account": "إنشاء حساب",
            "auth.welcome_back": "مرحبًا بعودتك",
            "auth.full_legal_name": "الاسم القانوني الكامل",
            "auth.email": "البريد الإلكتروني",
            "auth.password": "كلمة المرور",
            "auth.first_name": "الاسم الأول",
            "auth.last_name": "اسم العائلة",
            "auth.persona": "الشخصية",
            "common.done": "تم",
            "onboarding.welcome": "مرحبًا",
            "onboarding.welcome_description": "قم بإعداد شخصيتك الأولى وأعمدة النبض الخاصة بك. النبض لا يكون أبدًا صفرًا عند التشغيل الأول.",
            "onboarding.pulse_pillars": "أعمدة النبض",
            "onboarding.pillar_money": "المال",
            "onboarding.pillar_home_care": "رعاية المنزل",
            "onboarding.pillar_car_care": "رعاية السيارات",
            "onboarding.pillar_personal_care": "العناية الشخصية",
            "onboarding.pillar_goals": "الأهداف",
            "onboarding.pillar_planned_needs": "الاحتياجات المخطط لها",
            "onboarding.finish_setup": "إنهاء الإعداد",
            "onboarding.get_started": "ابدأ الآن",
            "home.guest_section_open_jobs": "الوظائف المفتوحة",
            "home.guest_section_available_helpers": "المساعدون المتاحون",
            "home.guest_section_tool_rentals": "تأجير الأدوات",
            "home.guest_section_open_jobs_subtitle": "شاهد طلبات العملاء المباشرة قبل الانضمام كمساعد.",
            "home.guest_section_available_helpers_subtitle": "ابحث عن مزودي الخدمات المحليين وقارن مؤشرات الثقة.",
            "home.guest_section_tool_rentals_subtitle": "تصفح الأدوات القريبة قبل الحجز.",
            "home.browse_help_jobs_tools": "تصفح المساعدة المحلية والوظائف والأدوات",
            "home.search_placeholder_text": "البحث عن الوظائف أو المساعدين أو الأدوات",
            "home.guest_section_jobs": "الوظائف",
            "home.guest_section_helpers": "المساعدون",
            "home.guest_section_tools": "الأدوات",
            "home.guest_empty_state_title": "لا توجد قوائم عامة مطابقة",
            "home.guest_empty_state_body": "جرّب بحثًا مختلفًا أو حدّث القوائم العامة.",
            "home.location_local_area": "المنطقة المحلية",
            "home.rating_label": "التقييم",
            "home.rating_stars": "نجوم.",
            "home.rate_prefix": "ابتداءً من",
            "guest.item_detail_job_prompt": "سجّل الدخول لإرسال رسالة أو تقديم عرض أو إدارة هذه الوظيفة.",
            "guest.action_view_job": "سجّل الدخول لعرض الوظيفة",
            "guest.action_book": "سجّل الدخول للحجز",
            "guest.action_reserve_prompt": "سجّل الدخول للحجز وتنسيق الاستلام وحماية وديعتك.",
            "guest.action_reserve": "سجّل الدخول للحجز",
            "auth.accept_terms": "أوافق على شروط الخدمة وسياسة الخصوصية",
            "auth.create_account_title": "إنشاء حساب",
            "auth.primary_persona": "الشخصية الرئيسية",
            "profile.settings": "الإعدادات",
            "profile.security": "الأمان",
            "profile.communication": "التواصل",
            "profile.push_title": "إشعارات التنبيهات",
            "profile.push_enable": "تفعيل إشعارات الدفع",
            "profile.push_authorized": "مفعل",
            "profile.push_denied": "مرفوض في إعدادات النظام",
            "profile.push_not_determined": "لم يتم الطلب بعد",
            "profile.push_unknown": "غير معروف",
            "profile.sign_out": "تسجيل الخروج",
            "force_update.title": "التحديث مطلوب",
            "force_update.body": "يرجى تحديث تطبيق OxSteed One للمتابعة.",
            "lock.title": "تم قفل OxSteed One",
            "lock.button": "فتح باستخدام Face ID / Touch ID",
            "sync.offline": "الوضع غير المتصل",
            "sync.pending": "قائمة المزامنة معلقة",
            "sync.offline_detail": "يتم حفظ التغييرات محليًا ومزامنتها عند عودة الاتصال.",
            "sync.button": "مزامنة",
            "home.customer_job_posting": "نشر طلب خدمة",
            "home.bids_comparison": "العروض + المقارنة",
            "home.customer_service_booking": "حجز خدمة العملاء",
            "home.tool_rental_flow": "سياقة استئجار الأدوات",
            "home.save_draft": "حفظ المسودة",
            "home.publish_job": "نشر العمل + إخطار المساعدين",
            "home.load_more_jobs": "تحميل وظائف إضافية",
            "home.load_more_bookings": "تحميل المزيد من الحجوزات",
            "home.load_more_rentals": "تحميل المزيد من الإيجارات",
            "home.loading": "جاري التحميل...",
            "home.sync_pending_changes": "تغييرات في انتظار المزامنة.",
            "home.search_placeholder": "ابحث عن الوظائف والمساعدة والأدوات والتدريب والتمويل",
            "home.run_today_build_tomorrow": "اعمل اليوم. ابنِ غدًا.",
            "home.one_account_many_personas": "حساب واحد. شخصيات متعددة. تتحدث الصفحة الرئيسية فورًا.",
            "home.persona": "الشخصية:",
            "home.role": "الدور:",
            "home.profile_settings": "الملف والإعدادات",
            "home.select_business": "اختر شركة",
            "home.job_title": "عنوان العمل",
            "home.category": "الفئة",
            "home.category_plumbing": "السباكة",
            "home.category_electrical": "الكهرباء",
            "home.category_hvac": "تكييف",
            "home.category_carpentry": "النجارة",
            "home.category_cleaning": "التنظيف",
            "home.location_autocomplete": "الإكمال التلقائي للموقع",
            "home.address": "العنوان",
            "home.describe_work": "وصف العمل",
            "home.add_photos": "إضافة صور (حتى 5)",
            "home.uploading_photos": "جاري رفع الصور…",
            "home.publishing_job": "نشر الوظيفة…",
            "home.retry": "إعادة المحاولة",
            "home.publish": "نشر",
            "home.start": "بدء",
            "home.complete": "إكمال",
            "home.cancel": "إلغاء",
            "home.post_job_for_bids": "انشر وظيفة لبدء استقبال العروض.",
            "home.job_picker": "الوظيفة",
            "home.sort": "ترتيب",
            "home.price_low_to_high": "السعر من الأقل إلى الأعلى",
            "home.price_high_to_low": "السعر من الأعلى إلى الأدنى",
            "home.helper_a_to_z": "المساعد أ→ز",
            "home.accepted": "مقبول",
            "home.accept_create_appointment": "قبول + إنشاء موعد",
            "home.message": "رسالة",
            "home.message_default_content": "هل يمكنك تأكيد النطاق والجدول الزمني؟",
            "home.message_helper": "رسالة للمساعد",
            "home.refreshing_bids": "تحديث العروض...",
            "home.retry_bid_sync": "إعادة محاولة مزامنة العروض",
            "home.search_helpers": "البحث عن المساعدين",
            "home.min_rating": "الحد الأدنى للتقييم:",
            "home.availability": "التوفر:",
            "home.service_type": "نوع الخدمة",
            "home.date": "التاريخ",
            "home.time_slot": "الفترة الزمنية",
            "home.payment_authorization": "تفويض الدفع",
            "home.pre_appointment_message": "رسالة قبل الموعد",
            "home.book_service": "حجز الخدمة",
            "home.creating_booking": "إنشاء الحجز...",
            "home.payment_prefix": "الدفع:",
            "home.payment_authorized": "مفوض",
            "home.payment_pending": "معلق",
            "home.post_appointment_message": "رسالة بعد الموعد",
            "home.confirm_payment": "تأكيد الدفع",
            "home.send_update": "إرسال تحديث",
            "home.cancel_booking": "إلغاء الحجز",
            "home.review_note": "ملاحظة المراجعة",
            "home.retry_booking_sync": "إعادة محاولة مزامنة الحجز",
            "home.search_tool_rentals": "البحث عن تأجير الأدوات",
            "home.max_daily_rate": "الحد الأقصى للسعر اليومي:",
            "home.tool_picker": "الأداة",
            "home.terms": "الشروط:",
            "home.available": "متاح:",
            "home.reservation_slot": "موعد الحجز",
            "home.reserve_tool": "حجز الأداة",
            "home.reserving_tool": "جاري حجز الأداة...",
            "home.deposit": "الوديعة:",
            "home.dispute": "النزاع:",
            "home.pickup": "استلام",
            "home.return": "إرجاع",
            "home.resolve_dispute": "حل النزاع",
            "home.open_dispute": "فتح نزاع",
            "home.damage_assessment": "تقييم الأضرار",
            "home.save_damage_notes": "حفظ ملاحظات الضرر",
            "home.retry_rental_sync": "إعادة محاولة مزامنة الإيجار",
            "home.add": "إضافة",
            "home.business_owner": "صاحب العمل",
            "home.create_alert_query": "إنشاء تنبيه بحث",
            "home.customer": "العميل",
            "home.customer_transactions": "معاملات العميل",
            "home.discovery_views": "أقسام الاكتشاف",
            "home.discovery_description": "تتوحد الخلاصة، الخريطة، والقائمة حسب سياق البحث حسب الشخصية.",
            "home.discovery_feed": "الموجز",
            "home.discovery_map": "الخريطة",
            "home.discovery_list": "القائمة",
            "home.discovery_alerts": "التنبيهات",
            "home.from": "من",
            "home.helper": "المساعد",
            "home.last_sync": "آخر مزامنة:",
            "home.loading_bookings": "تحميل الحجوزات…",
            "home.loading_jobs": "تحميل الوظائف…",
            "home.loading_jobs_near_you": "تحميل الوظائف القريبة منك…",
            "home.loading_rental_tools": "تحميل أدوات الإيجار…",
            "home.map_view": "عرض الخريطة",
            "home.no_search_results": "لا توجد نتائج في هذه المساحة: المنزل، الحياة، النمو، وتعلم.",
            "home.rating": "التقييم",
            "home.refresh_map_for_active_persona": "تحديث الخريطة للشخصية النشطة",
            "home.refreshes_customer_data": "تحديث الوظائف، العروض، المساعدين، المواعيد، والإيجارات من",
            "home.review_comment": "تعليق المراجعة",
            "home.saved_alert_example": "مثال تنبيه محفوظ: سباك بأقل من 150 دولار في سبرينغفيلد",
            "home.saved_search_alerts": "تنبيهات البحث المحفوظة",
            "home.search_results": "نتائج البحث",
            "home.sos": "إنذار الطوارئ",
            "home.sos_triggered": "تم تنشيط الإنذار: الموقع + سجل الحادث في قائمة الانتظار.",
            "home.start_safety_timer": "بدء مؤقت السلامة",
            "home.stop_safety_timer": "إيقاف مؤقت السلامة",
            "home.submit_review": "إرسال المراجعة",
            "home.sync_live_data": "تزامن البيانات المباشرة",
            "home.syncing": "المزامنة...",
            "home.title": "الصفحة الرئيسية",
            "home.to": "إلى",
            "home.trust_and_safety": "الثقة والأمان",
            "home.two_way_reviews": "التقييم المتبادل",
            "home.universal_search": "بحث شامل",
            "home.universal_search_note": "سيتم تنفيذ تنبيهات البحث المحفوظ والتراكب على الخريطة في الخطوة التالية.",
            "settings.active_persona": "الشخصية النشطة",
            "settings.persona": "الشخصية",
            "settings.business": "الأعمال",
            "settings.choose_business": "اختر شركة",
            "settings.language_localization": "اللغة وتوطين التطبيق",
            "settings.display_privacy": "العرض والخصوصية",
            "settings.availability_manager": "إدارة التوافر",
            "settings.account_recovery_export": "استرجاع الحساب والتصدير",
            "settings.request_data_export": "طلب تصدير البيانات",
            "settings.request_account_deletion": "طلب حذف الحساب",
            "settings.notification_preferences_persona": "تفضيلات الإشعارات حسب الشخصية",
            "settings.app_api": "واجهة برمجة التطبيقات للتطبيق"
            ,"profile.sub_role": "الدور الفرعي"
            ,"profile.assigned_role": "الدور المخصص"
            ,"profile.selected_business": "الشركة المختارة"
            ,"profile.no_business_selected": "لم يتم اختيار شركة"
            ,"profile.locale": "المنطقة"
            ,"profile.layout_direction": "اتجاه الواجهة"
            ,"profile.layout_rtl": "يمين إلى يسار"
            ,"profile.layout_ltr": "يسار إلى يمين"
            ,"profile.security_section": "الأمان"
            ,"profile.auto_translate_previews": "الترجمة التلقائية لمعاينات الرسائل"
            ,"profile.recovery_snapshot_ready": "صورة الاسترجاع جاهزة للاستعادة على جهاز جديد."
            ,"profile.recovery_snapshot_not_ready": "صورة الاسترجاع غير جاهزة."
            ,"profile.export_request_queued": "تم وضع طلب التصدير في الطابور."
            ,"profile.account_deletion_submitted": "تم تقديم طلب حذف الحساب."
            ,"settings.language": "اللغة"
            ,"settings.appearance": "المظهر"
            ,"settings.large_text_mode": "النص الكبير"
            ,"settings.privacy_mode": "وضع الخصوصية (إخفاء القيم الحساسة)"
            ,"settings.analytics_signals": "السماح بإشارات التحليل"
            ,"settings.persona": "الشخصية"
            ,"settings.alerts": "تنبيهات"
            ,"settings.radius": "النطاق"
            ,"settings.miles": "أميال"
            ,"settings.quiet_hours": "ساعات الهدوء"
            ,"settings.api_base_url": "عنوان URL الأساسي لواجهة برمجة التطبيقات"
            ,"settings.active": "نشيط"
            ,"settings.save_api_url": "حفظ عنوان URL لواجهة البرمجة"
            ,"settings.test_connection": "اختبار الاتصال"
            ,"settings.probe_auth_endpoints": "اختبار نقاط اتصال المصادقة"
            ,"settings.syncing": "المزامنة..."
            ,"settings.sync_now": "مزامنة الآن"
            ,"shop.growth_title": "النمو"
            ,"shop.economic_mobility_ladder": "سلم التنقل الاقتصادي"
            ,"shop.ladder_path": "المهارة → الدخل الجانبي → العمل المرخّص → التشغيل المتدرج"
            ,"shop.next_step": "الخطوة التالية:"
            ,"shop.business_ascension": "تصاعد النشاط"
            ,"shop.business_ascension_detail": "قدّم طلبًا للانتقال من العمل الجانبي إلى التشغيل المرخّص."
            ,"shop.community_wholesale_groups": "مجموعات الجملة المجتمعية"
            ,"shop.community_wholesale_groups_detail": "انضم إلى حملات الشراء الجماعي في الحي."
            ,"shop.financing_prequalification": "ما قبل التأهيل المالي"
            ,"shop.financing_prequalification_detail": "قروض صغيرة، معدات، ومسارات تمويل للبدء."
            ,"shop.grants_and_subsidies": "المنح والدعم"
            ,"shop.grants_and_subsidies_detail": "فرص مناسبة لمهنتك حسب الموقع."
            ,"shop.business_ascension_application": "طلب تصعيد النشاط"
            ,"shop.full_name": "الاسم الكامل"
            ,"shop.current_skill": "المهارة الحالية"
            ,"shop.target_license_business": "الرخصة/العمل المستهدف"
            ,"shop.submit_ascension_application": "إرسال طلب التصعيد"
            ,"shop.status_label": "الحالة:"
            ,"shop.ascension_status_not_started": "ابدأ طلب ترقية النشاط"
            ,"shop.ascension_status_submitted": "أكمل دروس التعلم لمسار الترخيص الخاص بك"
            ,"shop.ascension_status_financing_pending": "إرسال ما قبل التأهيل المالي"
            ,"shop.ascension_status_default": "انضم إلى مجموعة الجملة وابدأ أول عملية موسعة"
            ,"shop.community_wholesale_groups_header": "مجموعات الجملة المجتمعية"
            ,"shop.join": "انضم"
            ,"shop.joined": "تم الانضمام"
            ,"shop.requested_amount": "المبلغ المطلوب"
            ,"shop.purpose": "الغرض"
            ,"shop.monthly_revenue": "الإيرادات الشهرية"
            ,"shop.credit_band": "فئة الائتمان"
            ,"shop.credit_fair": "مقبول"
            ,"shop.credit_good": "جيد"
            ,"shop.credit_very_good": "ممتاز"
            ,"shop.submit_prequalification": "إرسال ما قبل التأهيل"
            ,"shop.apply": "تقديم"
            ,"shop.progress_tracker": "متابعة التقدم"
            ,"shop.progress_step_skill": "المهارة"
            ,"shop.progress_step_side_income": "دخل جانبي"
            ,"shop.progress_step_licensed_business": "عمل مرخّص"
            ,"shop.progress_step_scaled_operation": "توسع العمليات"
            ,"shop.current_step": "الخطوة الحالية"
            ,"shop.tax_document_center": "مركز مستندات الضرائب"
            ,"shop.tax_document_description": "ملخص سنوي بنمط النموذج 1099 وتتبّع الخصوم المسموحة."
            ,"shop.tax_year": "السنة الضريبية"
            ,"shop.gross": "الإجمالي"
            ,"shop.deductions": "الخصومات"
            ,"shop.voice_input": "الإدخال الصوتي"
            ,"shop.voice_input_enable_label": "تفعيل الإدخال الصوتي للنشر والدردشة"
            ,"shop.voice_input_description": "مسار الإملاء المعتمد على اللغة يتبع لغة التطبيق المختارة."
            ,"shop.live_growth_data": "بيانات النمو المباشرة"
            ,"shop.sync_live_data": "مزامنة البيانات المباشرة"
            ,"shop.wallet": "المحفظة"
            ,"shop.available": "متاح"
            ,"shop.pending_escrow": "رأسمال معلق"
            ,"shop.payout_method": "طريقة صرف الراتب"
            ,"shop.update_payout_method": "تحديث طريقة الصرف"
            ,"shop.save_payout_method": "حفظ طريقة الصرف"
            ,"shop.transaction_history": "سجل المعاملات"
            ,"shop.transaction_title": "عنوان المعاملة"
            ,"shop.amount": "المبلغ"
            ,"shop.credit": "ائتمان"
            ,"shop.add_transaction": "إضافة معاملة"
            ,"shop.consultant_profile_snapshot": "ملخص ملف الاستشاري"
            ,"shop.packages_label": "الطرود: %d"
            ,"shop.appointments_label": "المواعيد: %d"
            ,"shop.notes_label": "ملاحظات: %d"
            ,"shop.sync_growth_data_hint": "زامن البيانات المباشرة لتحميل ملف الاستشاري."
            ,"shop.tool_owner_inventory": "مخزون مالك الأدوات"
            ,"shop.sync_tool_inventory_hint": "زامن البيانات المباشرة لتحميل المخزون."
            ,"shop.available_prefix": "المتاح:"
            ,"shop.pending_returns": "المرتجعات المعلقة"
            ,"shop.quote_builder": "منشئ عرض السعر"
            ,"shop.customer_name": "اسم العميل"
            ,"shop.labor_amount": "أجرة العمل"
            ,"shop.material_amount": "أجرة المواد"
            ,"shop.quote_notes": "ملاحظات"
            ,"shop.save_quote_draft": "حفظ مسودة العرض"
            ,"shop.recurring_services": "الخدمات المتكررة"
            ,"shop.service_title": "عنوان الخدمة"
            ,"shop.frequency": "التكرار"
            ,"shop.frequency_weekly": "أسبوعي"
            ,"shop.frequency_bi_weekly": "كل أسبوعين"
            ,"shop.frequency_monthly": "شهري"
            ,"shop.frequency_label_next_date": "التاريخ التالي"
            ,"shop.create_plan": "إنشاء خطة"
            ,"shop.status_active": "نشط"
            ,"shop.status_paused": "معلق"
            ,"shop.financing_status_not_started": "لم يبدأ"
            ,"shop.financing_status_submitted": "تم الإرسال"
            ,"shop.pause": "إيقاف مؤقت"
            ,"shop.resume": "استئناف"
        ]
    ]
}
