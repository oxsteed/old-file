# Template Business Modes Roadmap

Last updated: 2026-05-11

Goal: every paid template should eventually change how OxSteed behaves for that helper or business, not only how the public profile looks. A template mode should define public CTAs, intake forms, dashboard widgets, records, reminders, reporting, and which OxSteed features are surfaced first.

## Implemented Foundation

### Property Manager

Templates: `property_manager`

Current behavior:
- Public business profile CTA becomes "Report a maintenance issue".
- CTA routes to `/business/:businessId/maintenance-request`.
- Tenant-facing maintenance intake captures issue category, urgency, property/unit, description, access notes, preferred times, permission-to-enter, phone, and photos.
- Backend stores requests in `property_maintenance_requests`, with timeline events in `property_maintenance_request_events`.
- Business Hub has a Maintenance tab for open/completed/cost stats, request review, scheduling, assignment/helper/vendor fields, tenant-visible updates, actual cost, helper search, and convert-to-job.

Next depth:
- Property/unit directory.
- Tenant invite links per property.
- Request-to-invoice and request-to-expense flows.
- Recurring maintenance schedules by property.
- Year-end report by property, unit, category, vendor, and cost.

## Template Mode Review

| Template | Mode | What It Needs |
| --- | --- | --- |
| `default` | General service | Keep broad profile, booking, jobs, messages, reviews. Do not over-specialize. |
| `trades_pro` | Field service | Estimate request, site visit scheduler, license/insurance proof, project phases, material notes, change orders. |
| `handyman` | Field service | Small-job intake, availability windows, tool/material checklist, recurring client reminders, quick invoice. |
| `home_garden` | Recurring home care | Seasonal plan, recurring visits, yard/home checklist, before/after photos, route-style calendar. |
| `cleaning_service` | Recurring appointment | Room checklist, recurring schedule, access instructions, supply preferences, satisfaction follow-up. |
| `pest_control` | Inspection service | Pest type intake, safety/pet notes, treatment plan, follow-up reminders, compliance notes. |
| `moving_hauling` | Logistics service | Pickup/dropoff addresses, inventory list, crew/truck requirements, time window, disposal notes. |
| `interior_design` | Project/portfolio | Consultation request, style quiz, room/project board, milestones, proposal approval. |
| `creative_studio` | Portfolio/project | Inquiry brief, deliverables, revision policy, asset upload, milestone payments. |
| `graphic_design` | Creative project | Brand brief, file requirements, revision rounds, proof approval, package pricing. |
| `music_audio` | Booking/project | Session booking, equipment needs, licensing notes, deliverables, revision/approval flow. |
| `writing_copy` | Content project | Brief intake, target audience, draft/revision stages, publishing deadlines. |
| `fitness_pro` | Appointment/coaching | Session packs, recurring plan, goals/progress notes, waiver, reminders. |
| `wellness_therapy` | Appointment/wellness | Intake notes, session preferences, privacy language, recurring appointments, aftercare notes. |
| `nutrition_diet` | Coaching plan | Goals, restrictions, meal plan milestones, progress check-ins, document sharing. |
| `mental_health` | Sensitive appointment | Strong privacy boundaries, emergency disclaimer, availability, intake, referral resources. |
| `care_trust` | Care service | Care recipient profile, emergency contacts, schedule, visit notes, background-check emphasis. |
| `pet_services` | Pet care | Pet profile, feeding/walk notes, vet contact, recurring visits, photo updates. |
| `tutoring_education` | Lessons | Subject goals, student level, recurring lessons, homework notes, progress reports. |
| `child_development` | Care/education | Child profile, guardian notes, safety forms, schedules, progress updates. |
| `events_entertainment` | Event booking | Event date, venue, run-of-show, equipment needs, deposits, cancellation terms. |
| `catering_food` | Event/order | Guest count, menu selection, allergy notes, delivery/setup timeline, deposit. |
| `wedding_services` | Event project | Wedding date, vendor coordination, package milestones, deposit/cancellation controls. |
| `beauty_style` | Appointment marketplace | Service menu, portfolio photos, deposits, cancellation/no-show protection, reminders. |
| `barbershop` | Appointment marketplace | Fast booking, recurring clients, no-show protection, tips, review/photo prompts. |
| `spa_skincare` | Appointment marketplace | Intake/contraindications, package booking, deposits, aftercare, reminders. |
| `tech_it` | Support service | Remote/on-site toggle, device details, urgency, ticket history, knowledge-base articles. |
| `web_app_dev` | Project/portfolio | Discovery brief, scope, milestones, deliverables, approvals, maintenance plan. |
| `consulting_coaching` | Consulting | Intake, call scheduler, action items, packages, recurring check-ins, reports. |
| `legal_admin` | Professional service | Intake, document upload, conflict/privacy language, consultation scheduler, records. |
| `electrician` | Licensed field service | License-first profile, hazard intake, permit notes, site visit, material estimate, safety disclaimer. |
| `photographer` | Event/portfolio | Shoot type, date/location, shot list, package selection, gallery delivery, usage rights. |
| `massage_therapist` | Appointment/wellness | Intake, contraindications, session type, recurring booking, cancellation rules. |
| `auto_mechanic` | Vehicle service | Vehicle profile/VIN, symptoms, photos/video, appointment/dropoff, estimate approval. |
| `dog_walker` | Pet recurring | Pet profile, route/time windows, access, recurring schedule, walk reports/photos. |
| `private_chef` | Event/order | Guest count, menu, allergies, kitchen access, deposit, event timeline. |
| `hair_stylist` | Appointment marketplace | Service menu, portfolio, deposits, reminders, client notes/history. |
| `accountant` | Professional service | Tax/business intake, document checklist, deadlines, secure records, year-end summaries. |
| `math_tutor` | Lessons | Student profile, subject gaps, recurring schedule, homework/progress reports. |
| `party_entertainer` | Event booking | Event details, audience age, equipment/space needs, deposit/cancellation, schedule. |
| `car_dealership` | Vehicle sales/service | Inventory leads, test-drive appointments, finance docs, trade-in intake, follow-up CRM. |

## Build Order Recommendation

1. Appointment marketplace mode: beauty, barber, hair, spa, massage, fitness, wellness.
2. Field service mode: handyman, trades, electrician, pest, moving, auto mechanic.
3. Care/recurring mode: pet services, dog walking, childcare/care trust, cleaning, tutoring.
4. Event/project mode: catering, wedding, entertainment, photography, private chef.
5. Professional/project mode: consulting, accounting, legal/admin, web/app, design/creative/writing.

## Shared Platform Pieces To Build Once

- Template mode registry stored server-side, not only in frontend metadata.
- Mode-aware dashboard cards and empty states.
- Mode-aware onboarding checklist.
- Mode-aware public CTA/intake forms.
- Mode-aware records and reporting.
- Mode-aware reminders, deposits, cancellation settings, and follow-up prompts.
