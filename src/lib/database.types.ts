export type SesionEstado =
  | 'lead'
  | 'seleccion'
  | 'pago_pendiente'
  | 'editando'
  | 'entregada'
  | 'archivada';
export type FotoTipo = 'preview' | 'final';
export type SesionOrigen = 'instagram' | 'referido' | 'web' | 'google' | 'tiktok' | 'otro';

export interface Paquete {
  id: string;
  nombre: string;
  fotos_incluidas: number;
  duracion_min: number;
  looks: number;
  precio_base: number | null;
  activo: boolean;
  orden: number;
  created_at: string;
}

export interface Sesion {
  id: string;
  codigo: string | null;
  nombre_cliente: string;
  email_cliente: string | null;
  telefono: string | null;
  handle_ig: string | null;
  ubicacion: string | null;
  fecha_preferida: string | null;
  es_estudiante: boolean;
  origen: SesionOrigen | null;
  paquete_id: string | null;
  limite_fotos: number | null;
  precio_extra: number;
  estado: SesionEstado;
  fecha_sesion: string | null;
  fecha_confirmacion: string | null;
  fecha_pago: string | null;
  monto_extras: number | null;
  payment_id: string | null;
  fecha_entrega: string | null;
  fecha_archivado: string | null;
  notas_admin: string | null;
  notas_sesion: string | null;
  notas_tecnicas: string | null;
  notion_page_id: string | null;
  precio_final: number | null;
  comprobante_50_url: string | null;
  email_archivo_aviso_enviado: boolean;
  created_at: string;
  updated_at: string;
}

export interface Foto {
  id: string;
  sesion_id: string;
  r2_key: string;
  tipo: FotoTipo;
  orden: number;
  original_filename: string | null;
  width: number | null;
  height: number | null;
  parent_foto_id: string | null;
  created_at: string;
}

export interface Seleccion {
  id: string;
  sesion_id: string;
  foto_id: string;
  nota: string | null;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      paquetes:    { Row: Paquete;    Insert: Partial<Paquete>;    Update: Partial<Paquete>    };
      sesiones:    { Row: Sesion;     Insert: Partial<Sesion>;     Update: Partial<Sesion>     };
      fotos:       { Row: Foto;       Insert: Partial<Foto>;       Update: Partial<Foto>       };
      selecciones: { Row: Seleccion;  Insert: Partial<Seleccion>;  Update: Partial<Seleccion>  };
      admin_users: { Row: AdminUser;  Insert: Partial<AdminUser>;  Update: Partial<AdminUser>  };
    };
  };
}
