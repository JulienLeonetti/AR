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

let hitTestSource = null;
let hitTestSourceRequested = false;

let current_object = null;
let loading_model = null;

// Modèle actuellement sélectionné dans le menu
let selected_model = '1';

// Tous les modèles déjà placés
let placed_objects = [];

init();

function init() {

    scene = new THREE.Scene();

    const hdrLoader = new RGBELoader();

    hdrLoader.load(
        'textures/environment.hdr',
        function (texture) {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            scene.environment = texture;
        },
        undefined,
        function (error) {
            console.error(
                'Erreur lors du chargement de la texture HDR',
                error
            );
        }
    );

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

    controls = new OrbitControls(
        camera,
        renderer.domElement
    );

    controls.target.set(
        0,
        0,
        0
    );

    controls.update();

    const domOverlay = document.getElementById('content');

    // Les interactions avec le menu et les boutons ne doivent pas
    // déclencher un événement de sélection dans la scène WebXR.
    domOverlay.addEventListener(
        'beforexrselect',
        function (event) {
            event.preventDefault();
        }
    );

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

            const session = renderer.xr.getSession();

            if (!session.domOverlayState) {
                console.error(
                    'Le DOM Overlay n’est pas disponible pour cette session AR.'
                );
            }

            // Le modèle en attente de placement est caché
            if (current_object) {
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

            if (controls) {
                controls.enabled = true;
            }

            // Le modèle non placé revient à sa position initiale
            if (current_object) {

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


            // Supprime uniquement le modèle qui était
            // en attente de placement.
            //
            // Les modèles déjà placés ne sont PAS supprimés.
            if (current_object) {

                scene.remove(
                    current_object
                );

                current_object = null;
            }


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

document.getElementById('addButton').addEventListener(
    'click',
    function () {
        loadModel(selected_model);
    }
);

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

        placed_objects = [];
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


    // Place le modèle à l'endroit du reticle
    current_object.position.setFromMatrixPosition(
        reticle.matrix
    );

    current_object.visible = true;


    // On ajoute le modèle à la liste
    // des modèles définitivement placés
    placed_objects.push(
        current_object
    );


    // Il n'est plus le modèle en attente
    current_object = null;


    // -------------------------------------------------
    // IMPORTANT :
    // On recharge automatiquement une nouvelle copie
    // du MEME modèle.
    //
    // Ainsi, si item 1 est sélectionné :
    //
    // clic -> item 1
    // clic -> item 1
    // clic -> item 1
    // clic -> item 1
    // ...
    //
    // sans avoir besoin de retourner dans le menu.
    // -------------------------------------------------

    loadModel(
        selected_model
    );
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

                reticle.matrix.fromArray(
                    pose.transform.matrix
                );
            }

        } else {

            reticle.visible = false;
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
