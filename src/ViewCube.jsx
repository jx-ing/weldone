import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
// This is a live 3D orientation control, rendered as geometry rather than a static image.
export default function ViewCube({ onView }) {
    const host = useRef(), latest = useRef(onView);
    latest.current = onView;
    useEffect(() => { const el = host.current; let renderer; try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    }
    catch {
        return;
    } renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(112, 112); el.appendChild(renderer.domElement); const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, .1, 30); camera.position.set(3, 2.5, 3); camera.lookAt(0, 0, 0); const textures = []; const names = ['RIGHT', 'LEFT', 'TOP', 'BOTTOM', 'FRONT', 'BACK']; const materials = names.map((label, i) => { const c = document.createElement('canvas'); c.width = c.height = 256; const ctx = c.getContext('2d'); ctx.fillStyle = i === 2 ? '#e8e8e8' : i === 0 ? '#b7b7b7' : '#c9c9c9'; ctx.fillRect(0, 0, 256, 256); ctx.strokeStyle = '#f5f5f5'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 246, 246); ctx.fillStyle = '#666'; ctx.font = '26px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; textures.push(t); return new THREE.MeshBasicMaterial({ map: t }); }); const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1.65, 1.65), materials); scene.add(mesh); const edge = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xf5f5f5 })); scene.add(edge); renderer.render(scene, camera); const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); const click = e => { const r = renderer.domElement.getBoundingClientRect(); mouse.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(mouse, camera); const hit = ray.intersectObject(mesh)[0]; if (hit)
        latest.current(({ 0: 'right', 1: 'right', 2: 'top', 3: 'top', 4: 'front', 5: 'front' })[hit.face.materialIndex]);
    else
        latest.current('iso'); }; renderer.domElement.addEventListener('click', click); return () => { renderer.domElement.removeEventListener('click', click); mesh.geometry.dispose(); edge.geometry.dispose(); edge.material.dispose(); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); renderer.dispose(); renderer.domElement.remove(); }; }, []);
    return <div ref={host} className="view-cube" title="单击立方体切换视角"/>;
}
