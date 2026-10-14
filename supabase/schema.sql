-- =====================================================================
-- Esquema multi-tenant en Supabase (PostgreSQL) para los asistentes de IA
--
-- Un "tenant" es un cliente del SaaS: una personal shopper (asistente de WhatsApp)
-- o un comercio (chatbot de stock para su sitio web). Todas las tablas llevan
-- tenant_id y Row Level Security, así un cliente nunca puede leer datos de otro.
--
-- ESQUEMA DE REFERENCIA: ajustarlo para que coincida con la base real del proyecto.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Clientes del SaaS ----------
create table tenants (
    id              uuid primary key default gen_random_uuid(),
    nombre          text not null,
    tipo            text not null check (tipo in ('personal_shopper', 'comercio')),
    whatsapp_numero text unique,                 -- número de WhatsApp Business asignado
    dominio_web     text,                        -- sitio autorizado a usar el widget
    widget_clave    text unique default encode(gen_random_bytes(16), 'hex'),
    activo          boolean not null default true,
    creado_en       timestamptz not null default now()
);

-- ---------- Suscripciones (sincronizadas desde Stripe por webhook) ----------
create table suscripciones (
    tenant_id           uuid primary key references tenants(id) on delete cascade,
    stripe_customer_id  text unique,
    stripe_subscription text unique,
    estado              text not null check (estado in ('trialing', 'active', 'past_due', 'canceled', 'unpaid')),
    vence_en            timestamptz,
    actualizado_en      timestamptz not null default now()
);

-- Un tenant puede usar el servicio si está activo y su suscripción está al día.
-- n8n consulta esta vista antes de llamar al modelo de IA: si no hay pago, no hay respuesta.
create view tenants_habilitados as
select t.id, t.nombre, t.tipo, t.whatsapp_numero, t.dominio_web, t.widget_clave
from tenants t
join suscripciones s on s.tenant_id = t.id
where t.activo
  and s.estado in ('trialing', 'active');

-- ---------- Conversaciones y mensajes (memoria del asistente) ----------
create table conversaciones (
    id            uuid primary key default gen_random_uuid(),
    tenant_id     uuid not null references tenants(id) on delete cascade,
    canal         text not null check (canal in ('whatsapp', 'web')),
    contacto      text not null,                 -- teléfono o id de sesión del visitante
    iniciada_en   timestamptz not null default now(),
    ultima_actividad timestamptz not null default now(),
    unique (tenant_id, canal, contacto)
);

create table mensajes (
    id               bigint generated always as identity primary key,
    tenant_id        uuid not null references tenants(id) on delete cascade,
    conversacion_id  uuid not null references conversaciones(id) on delete cascade,
    rol              text not null check (rol in ('usuario', 'asistente', 'herramienta')),
    contenido        text not null,
    tokens_entrada   int,
    tokens_salida    int,
    creado_en        timestamptz not null default now()
);
create index on mensajes (conversacion_id, creado_en desc);   -- últimos N mensajes = contexto
create index on mensajes (tenant_id, creado_en);              -- consumo por cliente y mes

-- ---------- Catálogo y stock de cada comercio (chatbot web) ----------
create table productos (
    id          bigint generated always as identity primary key,
    tenant_id   uuid not null references tenants(id) on delete cascade,
    sku         text not null,
    nombre      text not null,
    categoria   text,
    atributos   jsonb not null default '{}'::jsonb,   -- medida, marca, compatibilidad, etc.
    precio      numeric(12, 2),
    stock       int not null default 0 check (stock >= 0),
    actualizado_en timestamptz not null default now(),
    unique (tenant_id, sku)
);
create index on productos using gin (atributos);
create index on productos (tenant_id, lower(nombre));

-- Búsqueda que usa el agente de IA como herramienta: siempre filtrada por tenant
create or replace function buscar_stock(p_tenant uuid, p_texto text, p_limite int default 5)
returns table (sku text, nombre text, precio numeric, stock int, atributos jsonb)
language sql stable as $$
    select sku, nombre, precio, stock, atributos
    from productos
    where tenant_id = p_tenant
      and (nombre ilike '%' || p_texto || '%'
           or sku ilike '%' || p_texto || '%'
           or atributos::text ilike '%' || p_texto || '%')
    order by stock > 0 desc, nombre
    limit p_limite;
$$;

-- ---------- Consumo mensual (para facturación y control de costos de IA) ----------
create view consumo_mensual as
select tenant_id,
       date_trunc('month', creado_en) as mes,
       count(*) filter (where rol = 'usuario') as mensajes_recibidos,
       coalesce(sum(tokens_entrada), 0)       as tokens_entrada,
       coalesce(sum(tokens_salida), 0)        as tokens_salida
from mensajes
group by tenant_id, date_trunc('month', creado_en);

-- ---------- Row Level Security ----------
-- n8n usa la service_role key (salta RLS). Los paneles de cada cliente usan la anon key
-- con un JWT que incluye el tenant_id en app_metadata.
alter table tenants        enable row level security;
alter table suscripciones  enable row level security;
alter table conversaciones enable row level security;
alter table mensajes       enable row level security;
alter table productos      enable row level security;

create or replace function tenant_actual() returns uuid
language sql stable as $$
    select nullif(auth.jwt() -> 'app_metadata' ->> 'tenant_id', '')::uuid
$$;

create policy "tenant ve su ficha"         on tenants        for select using (id = tenant_actual());
create policy "tenant ve su suscripcion"   on suscripciones  for select using (tenant_id = tenant_actual());
create policy "tenant ve sus conversaciones" on conversaciones for select using (tenant_id = tenant_actual());
create policy "tenant ve sus mensajes"     on mensajes       for select using (tenant_id = tenant_actual());
create policy "tenant gestiona su catalogo" on productos     for all
    using (tenant_id = tenant_actual()) with check (tenant_id = tenant_actual());
