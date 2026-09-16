import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { GLTFLoader } from 'three/addons/webxr/GLTFLoader.js';
import { OrbitControls } from 'three/addons/webxr/OrbitControls.js';
import { RGBELoader } from 'three/addons/webxr/RGBELoader.js';

let scene;
let camera;
let renderer;
let reticle;
let controls;
let controller;
let selectionHelper = null;
let pmremGenerator;
let environmentRenderTarget;
let actionButtons;
let placeButton;

let touchDown = false;
let touchX = 0;
let touchY = 0;
let deltaX = 0;
let deltaY = 0;
let lastTouchAngle = null;

let hitTestSource = null;
let hitTestSourceRequested = false;

let current_object = null;
let loading_model = null;

// Modèle actuellement sélectionné dans le menu
let selected_model = '1';

// Tous les modèles déjà placés
let placed_objects = [];

const raycaster = new THREE.Raycaster();
const controllerRotation = new THREE.Matrix4();

init();

function init() {

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(
        70,
        window.innerWidth / window.innerHeight,
        0.01,
        20
    );

    const light = new THREE.HemisphereLight(
        0xffffff,
        0xbbbbff,
        3
    );

    light.position.set(
        0.5,
        1,
        0.25
    );

    scene.add(light);

    renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true
    });

    renderer.setPixelRatio(
        window.devicePixelRatio
    );

    renderer.setSize(
        window.innerWidth,
        window.innerHeight
    );

    renderer.xr.enabled = true;

    document.body.appendChild(
        renderer.domElement
    );

    pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    new RGBELoader()
        .setDataType(THREE.HalfFloatType)
        .load(
            'textures/environment.hdr',
            function (texture) {
                environmentRenderTarget =
                    pmremGenerator.fromEquirectangular(texture);

                scene.environment =
                    environmentRenderTarget.texture;

                texture.dispose();
                pmremGenerator.dispose();
                pmremGenerator = null;
            },
            undefined,
            function (error) {
                pmremGenerator.dispose();
                pmremGenerator = null;

                console.error(
                    'Erreur lors du chargement de la texture HDR',
                    error
                );
            }
        );

    controls = new OrbitControls(
        camera,
        renderer.domElement
    );

    controls.target.set(
        0,
        0,
        -0.2
    );

    controls.minDistance = 2;
    controls.maxDistance = 10;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    controls.update();

    renderer.domElement.addEventListener(
        'touchstart',
        function (event) {
            event.preventDefault();

            if (event.touches.length === 0) {
                return;
            }

            touchDown = true;
            touchX = event.touches[0].pageX;
            touchY = event.touches[0].pageY;

            if (event.touches.length >= 2) {
                lastTouchAngle = getTouchAngle(event.touches);
            }
        },
        { passive: false }
    );

    renderer.domElement.addEventListener(
        'touchend',
        function (event) {
            event.preventDefault();

            if (event.touches.length === 0) {
                touchDown = false;
                lastTouchAngle = null;
                return;
            }

            touchX = event.touches[0].pageX;
            touchY = event.touches[0].pageY;

            lastTouchAngle =
                event.touches.length >= 2
                    ? getTouchAngle(event.touches)
                    : null;
        },
        { passive: false }
    );

    renderer.domElement.addEventListener(
        'touchcancel',
        function (event) {
            event.preventDefault();
            touchDown = false;
            lastTouchAngle = null;
        },
        { passive: false }
    );

    renderer.domElement.addEventListener(
        'touchmove',
        function (event) {
            event.preventDefault();

            if (
                !touchDown ||
                event.touches.length === 0
            ) {
                return;
            }

            if (event.touches.length >= 2) {

                const touchAngle =
                    getTouchAngle(event.touches);

                if (lastTouchAngle !== null) {
                    rotateObjectOnZ(
                        normalizeAngle(
                            touchAngle - lastTouchAngle
                        )
                    );
                }

                lastTouchAngle = touchAngle;
                return;
            }

            lastTouchAngle = null;

            deltaX =
                event.touches[0].pageX - touchX;

            deltaY =
                event.touches[0].pageY - touchY;

            touchX = event.touches[0].pageX;
            touchY = event.touches[0].pageY;

            rotateObject();
        },
        { passive: false }
    );

    const domOverlay = document.getElementById('content');

    actionButtons = document.getElementById('actionButtons');
    placeButton = document.getElementById('placeButton');

    // Les interactions avec le menu et les boutons ne doivent pas
    // déclencher un événement de sélection dans la scène WebXR.
    domOverlay.addEventListener(
        'beforexrselect',
        function (event) {
            event.preventDefault();
        }
    );

    controller = renderer.xr.getController(0);
    controller.addEventListener(
        'select',
        onObjectSelect
    );
    scene.add(controller);

    const options = {

        requiredFeatures: [
            'hit-test',
            'dom-overlay'
        ],

        domOverlay: {
            root: domOverlay
        }
    };

    document.body.appendChild(
        ARButton.createButton(
            renderer,
            options
        )
    );

    const geometry =
        new THREE.RingGeometry(
            0.15,
            0.20,
            32
        );

    geometry.rotateX(
        -Math.PI / 2
    );

    const material =
        new THREE.MeshBasicMaterial({
            color: 0xffffff
        });

    reticle = new THREE.Mesh(
        geometry,
        material
    );

    reticle.matrixAutoUpdate = false;
    reticle.visible = false;

    scene.add(reticle);


    // -------------------------------------------------
    // DEBUT DE SESSION AR
    // -------------------------------------------------

    renderer.xr.addEventListener(
        'sessionstart',
        function () {

            hitTestSource = null;
            hitTestSourceRequested = false;

            reticle.visible = false;
            actionButtons.style.display = 'flex';
            placeButton.style.display = 'none';

            const session = renderer.xr.getSession();

            if (!session.domOverlayState) {
                console.error(
                    'Le DOM Overlay n’est pas disponible pour cette session AR.'
                );
            }

            // Seul le modèle qui n'a pas encore été placé est caché.
            if (
                current_object &&
                !placed_objects.includes(current_object)
            ) {
                current_object.visible = false;
            }

            if (controls) {
                controls.enabled = false;
            }
        }
    );


    // -------------------------------------------------
    // FIN DE SESSION AR
    // -------------------------------------------------

    renderer.xr.addEventListener(
        'sessionend',
        function () {

            hitTestSource = null;
            hitTestSourceRequested = false;

            reticle.visible = false;
            placeButton.style.display = 'none';
            actionButtons.style.display = 'none';

            if (controls) {
                controls.enabled = true;
            }

            clearSelectionHelper();

            // Le modèle non placé revient à sa position initiale.
            if (
                current_object &&
                !placed_objects.includes(current_object)
            ) {

                current_object.position.set(
                    0,
                    0,
                    -2
                );

                current_object.visible = true;
            }
        }
    );


    window.addEventListener(
        'resize',
        onWindowResize
    );


    renderer.setAnimationLoop(
        animate
    );


    // Modèle chargé au démarrage
    loadModel('1');
}


// -------------------------------------------------
// CHARGEMENT D'UN MODELE
// -------------------------------------------------

function loadModel(model) {

    loading_model = model;

    selected_model = model;

    const loader = new GLTFLoader();

    loader.load(

        'model/' + model + '.glb',

        function (gltf) {

            // Si un autre modèle a été sélectionné
            // pendant le chargement, on ignore celui-ci
            if (loading_model !== model) {
                return;
            }


            // Supprime uniquement le modèle qui n'a pas encore été placé.
            // Un modèle déjà placé reste dans la scène.
            if (
                current_object &&
                !placed_objects.includes(current_object)
            ) {

                scene.remove(
                    current_object
                );

                current_object = null;
            }

            clearSelectionHelper();


            // Centre le modèle dans un groupe parent.
            // Le groupe peut être déplacé sans perdre le centrage.
            const model_scene =
                gltf.scene;

            const box =
                new THREE.Box3()
                    .setFromObject(
                        model_scene
                    );

            const center =
                box.getCenter(
                    new THREE.Vector3()
                );

            const size =
                box.getSize(
                    new THREE.Vector3()
                );

            const max_size = Math.max(
                size.x,
                size.y,
                size.z
            );

            model_scene.position.sub(
                center
            );

            current_object =
                new THREE.Group();

            current_object.userData.modelId = model;

            current_object.add(
                model_scene
            );

            // Tous les modèles ont une dimension maximale de 50 cm.
            if (max_size > 0) {
                current_object.scale.setScalar(
                    0.5 / max_size
                );
            }

            scene.add(
                current_object
            );

            // Position de départ
            current_object.position.set(
                0,
                0,
                -2
            );


            current_object.visible = true;


            // Pendant l'AR, il sera affiché
            // uniquement après détection d'une surface
            if (renderer.xr.isPresenting) {

                current_object.visible = false;
            }
        },

        undefined,

        function (error) {

            console.error(
                'Erreur lors du chargement de ' +
                model +
                '.glb',
                error
            );
        }
    );
}


// -------------------------------------------------
// MENU : CHANGEMENT DE MODELE
// -------------------------------------------------

$('.ar-object').click(function (event) {

    event.preventDefault();

    const model =
        $(this).attr('id');


    // On mémorise le modèle sélectionné
    selected_model = model;


    // On prépare un nouveau modèle
    loadModel(model);


    // Ferme le menu
    closeNav();
});


// -------------------------------------------------
// BOUTONS D'ACTION
// -------------------------------------------------

document.getElementById('placeButton').addEventListener(
    'click',
    onSelect
);

document.getElementById('clearButton').addEventListener(
    'click',
    function () {
        placed_objects.forEach(function (object) {
            scene.remove(object);
        });

        if (
            current_object &&
            !placed_objects.includes(current_object)
        ) {
            scene.remove(current_object);
        }

        placed_objects = [];
        current_object = null;
        loading_model = null;
        clearSelectionHelper();
    }
);


// -------------------------------------------------
// PLACEMENT D'UN MODELE
// -------------------------------------------------

function onSelect() {

    // Aucun modèle à placer
    if (!current_object) {
        return;
    }


    // Aucune surface détectée
    if (!reticle.visible) {
        return;
    }


    const objectWasAlreadyPlaced =
        placed_objects.includes(current_object);

    // Place ou déplace le modèle à l'endroit du réticule.
    current_object.position.setFromMatrixPosition(
        reticle.matrix
    );

    current_object.visible = true;


    if (!objectWasAlreadyPlaced) {
        placed_objects.push(current_object);

        // Prépare automatiquement une nouvelle copie du même modèle.
        current_object = null;
        clearSelectionHelper();
        placeButton.style.display = 'none';
        loadModel(selected_model);
    } else if (selectionHelper) {

        // Le même objet reste sélectionné après son déplacement.
        selectionHelper.update();
    }
}


// -------------------------------------------------
// SELECTION D'UN OBJET DEJA PLACE
// -------------------------------------------------

function onObjectSelect() {

    controllerRotation
        .identity()
        .extractRotation(controller.matrixWorld);

    raycaster.ray.origin.setFromMatrixPosition(
        controller.matrixWorld
    );

    raycaster.ray.direction
        .set(0, 0, -1)
        .applyMatrix4(controllerRotation);

    const intersections = raycaster.intersectObjects(
        placed_objects,
        true
    );

    if (intersections.length === 0) {
        return;
    }

    let selectedObject = intersections[0].object;

    while (
        selectedObject.parent &&
        !placed_objects.includes(selectedObject)
    ) {
        selectedObject = selectedObject.parent;
    }

    if (!placed_objects.includes(selectedObject)) {
        return;
    }

    // Supprime l'éventuelle copie encore en attente de placement.
    if (
        current_object &&
        !placed_objects.includes(current_object)
    ) {
        scene.remove(current_object);
    }

    loading_model = null;
    current_object = selectedObject;
    selected_model =
        current_object.userData.modelId || selected_model;

    showSelectionHelper(current_object);
}


function showSelectionHelper(object) {

    clearSelectionHelper();

    selectionHelper = new THREE.BoxHelper(
        object,
        0xffff00
    );

    scene.add(selectionHelper);
}


function clearSelectionHelper() {

    if (!selectionHelper) {
        return;
    }

    scene.remove(selectionHelper);
    selectionHelper.geometry.dispose();
    selectionHelper.material.dispose();
    selectionHelper = null;
}


// -------------------------------------------------
// ROTATION TACTILE DU MODELE COURANT
// -------------------------------------------------

function rotateObject() {

    if (
        current_object &&
        reticle.visible
    ) {
        current_object.rotation.y += deltaX / 100;
        current_object.rotation.x += deltaY / 100;

        if (selectionHelper) {
            selectionHelper.update();
        }
    }
}


function rotateObjectOnZ(angle) {

    if (
        current_object &&
        reticle.visible
    ) {
        current_object.rotation.z += angle;

        if (selectionHelper) {
            selectionHelper.update();
        }
    }
}


function getTouchAngle(touches) {

    return Math.atan2(
        touches[1].pageY - touches[0].pageY,
        touches[1].pageX - touches[0].pageX
    );
}


function normalizeAngle(angle) {

    if (angle > Math.PI) {
        return angle - Math.PI * 2;
    }

    if (angle < -Math.PI) {
        return angle + Math.PI * 2;
    }

    return angle;
}


// -------------------------------------------------
// ANIMATION
// -------------------------------------------------

function animate(
    timestamp,
    frame
) {

    // Pas de session AR
    if (!frame) {

        if (controls && controls.enabled) {
            controls.update();
        }

        renderer.render(
            scene,
            camera
        );

        return;
    }


    const referenceSpace =
        renderer.xr.getReferenceSpace();

    const session =
        renderer.xr.getSession();


    // -------------------------------------------------
    // DEMANDE DU HIT TEST
    // -------------------------------------------------

    if (!hitTestSourceRequested) {

        hitTestSourceRequested = true;

        session
            .requestReferenceSpace(
                'viewer'
            )

            .then(
                function (viewerSpace) {

                    return session
                        .requestHitTestSource({
                            space: viewerSpace
                        });
                }
            )

            .then(
                function (source) {

                    hitTestSource =
                        source;
                }
            )

            .catch(
                function (error) {

                    console.error(
                        'Erreur Hit Test :',
                        error
                    );

                    hitTestSourceRequested =
                        false;
                }
            );
    }


    // -------------------------------------------------
    // RECUPERATION DU HIT TEST
    // -------------------------------------------------

    if (hitTestSource) {

        const hitTestResults =
            frame.getHitTestResults(
                hitTestSource
            );


        if (
            hitTestResults.length > 0
        ) {

            const hit =
                hitTestResults[0];


            const pose =
                hit.getPose(
                    referenceSpace
                );


            if (pose) {

                reticle.visible = true;
                placeButton.style.display =
                    current_object ? 'block' : 'none';

                reticle.matrix.fromArray(
                    pose.transform.matrix
                );
            } else {

                reticle.visible = false;
                placeButton.style.display = 'none';
            }

        } else {

            reticle.visible = false;
            placeButton.style.display = 'none';
        }
    }


    // -------------------------------------------------
    // AFFICHAGE
    // -------------------------------------------------

    renderer.render(
        scene,
        camera
    );
}


// -------------------------------------------------
// RESIZE
// -------------------------------------------------

function onWindowResize() {

    camera.aspect =
        window.innerWidth /
        window.innerHeight;

    camera.updateProjectionMatrix();


    if (!renderer.xr.isPresenting) {

        renderer.setSize(
            window.innerWidth,
            window.innerHeight
        );
    }
}
