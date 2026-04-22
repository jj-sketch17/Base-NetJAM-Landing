import os
from PIL import Image

assets_dir = r"c:\Users\Administrador\Desktop\Netjam-Landing Viejo\ASSETS"

# Mapping of old names to new standard names
renames = {
    "Gestion de Servidores.jpg": "gestion-servidores",
    "Instalacion de Redes.jpg": "instalacion-redes",
    "Logo NetJAM.jpg": "logo-netjam",
    "Logo-NetJAM Plano.jpg": "logo-netjam-plano",
    "Socio Tecnologico.jpg": "socio-tecnologico",
    "Soporte Tecnico.jpg": "soporte-tecnico",
    "icono superior derecha.jpg": "icono-nav"
}

os.chdir(assets_dir)

for old_name, new_base in renames.items():
    if os.path.exists(old_name):
        print(f"Processing {old_name}...")
        try:
            img = Image.open(old_name)
            if img.mode != 'RGB':
                img = img.convert('RGB')
            
            # We want webp
            # Max width for normal images 1920 (hero), others smaller
            if new_base in ['logo-netjam', 'socio-tecnologico']:
                img.thumbnail((1200, 1200)) # resize to max 1200x1200 while keeping aspect ratio
            elif new_base in ['gestion-servidores', 'instalacion-redes', 'soporte-tecnico']:
                img.thumbnail((800, 800))
            elif new_base == 'icono-nav':
                img.thumbnail((400, 400))
            
            img.save(f"{new_base}.webp", 'WEBP', quality=85)
            
            # Also save a standard JPG version just for OG Image and fallback
            img.save(f"{new_base}.jpg", 'JPEG', quality=85)
            
        except Exception as e:
            print(f"Error processing {old_name}: {e}")
print("Done!")
