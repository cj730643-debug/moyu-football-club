revoke all on table public.mfc_room_signal from anon,authenticated;
grant select on table public.mfc_room_signal to authenticated;
grant all on table public.mfc_room_signal to service_role;
;
