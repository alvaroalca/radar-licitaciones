// Perfil de la empresa que mira el radar. Vive en el navegador: la web es para demos en local
// y no tiene login. Trae tres empresas de ejemplo, ficticias, para enseñar el encaje.

export type Clasificacion = { grupo: string; subgrupo: string; categoria: string }

export type Perfil = {
  id: string
  nombre: string
  facturacion: number | null          // volumen anual de negocios, mejor de los tres últimos años
  familias: string[]                  // prefijos de CPV en los que trabaja
  certificaciones: string[]           // ids de CERTIFICACIONES
  clasificaciones: Clasificacion[]
}

// Familias de CPV de TI, por prefijo
export const FAMILIAS: Record<string, string> = {
  '722': 'Desarrollo y consultoría de software',
  '723': 'Datos y bases de datos',
  '724': 'Internet y alojamiento',
  '725': 'Soporte y mantenimiento informático',
  '726': 'Apoyo y consultoría informática',
  '727': 'Redes informáticas',
  '728': 'Auditoría y pruebas informáticas',
  '48': 'Licencias y paquetes de software',
}

export const CERTIFICACIONES: Record<string, string> = {
  iso9001: 'ISO 9001',
  iso14001: 'ISO 14001',
  iso20000: 'ISO 20000',
  iso27001: 'ISO 27001',
  iso22301: 'ISO 22301',
  iso27017: 'ISO 27017 / 27018',
  ens_basico: 'ENS básico',
  ens_medio: 'ENS medio',
  ens_alto: 'ENS alto',
}

// Nombres ficticios y marcados como ejemplo: no deben parecer empresas reales
export const PERFILES_DEMO: Perfil[] = [
  {
    id: 'demo-estudio',
    nombre: 'Ejemplo: estudio web de 5 personas',
    facturacion: 180_000,
    familias: ['722', '724'],
    certificaciones: [],
    clasificaciones: [],
  },
  {
    id: 'demo-ciber',
    nombre: 'Ejemplo: consultora de ciberseguridad',
    facturacion: 1_200_000,
    familias: ['722', '725', '726', '727', '728'],
    certificaciones: ['iso9001', 'iso27001', 'iso20000', 'ens_alto'],
    clasificaciones: [{ grupo: 'V', subgrupo: '2', categoria: '3' }],
  },
  {
    id: 'demo-integrador',
    nombre: 'Ejemplo: integrador grande',
    facturacion: 12_000_000,
    familias: Object.keys(FAMILIAS),
    certificaciones: Object.keys(CERTIFICACIONES),
    clasificaciones: [
      { grupo: 'V', subgrupo: '2', categoria: '5' },
      { grupo: 'V', subgrupo: '3', categoria: '5' },
      { grupo: 'V', subgrupo: '5', categoria: '5' },
    ],
  },
]

const CLAVE = 'radar-licitaciones:perfil'

// El almacenamiento del navegador puede fallar (modo privado, datos bloqueados): sin él, el
// perfil dura lo que la pestaña
export function cargarPerfil(): Perfil | null {
  try {
    const guardado = localStorage.getItem(CLAVE)
    return guardado ? (JSON.parse(guardado) as Perfil) : null
  } catch {
    return null
  }
}

export function guardarPerfil(p: Perfil | null) {
  try {
    if (p) localStorage.setItem(CLAVE, JSON.stringify(p))
    else localStorage.removeItem(CLAVE)
  } catch { /* sin almacenamiento: el perfil vive solo en memoria */ }
}
