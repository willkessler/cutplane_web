// Made by docker/coin/make.sh from Coin3D's nodes: don't edit.
//
// Binary Inventor files don't say what type a built-in node's fields are (the
// reader is meant to know), so this says, for each Inventor node: its fields
// and their types, one line a node; a + after its name marks a group (its
// children follow its fields).
export const INVENTOR_FIELDS = `
AlphaTest function:SFEnum value:SFFloat
Annotation+ renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum
AppearanceKit callbackList:SFNode lightModel:SFNode environment:SFNode drawStyle:SFNode material:SFNode complexity:SFNode texture2:SFNode font:SFNode
Array+ origin:SFEnum numElements1:SFShort numElements2:SFShort numElements3:SFShort separation1:SFVec3f separation2:SFVec3f separation3:SFVec3f
AsciiText string:MFString spacing:SFFloat justification:SFEnum width:MFFloat
BaseColor rgb:MFColor
BaseKit callbackList:SFNode
Blinker+ whichChild:SFInt32 speed:SFFloat on:SFBool
BumpMap filename:SFString image:SFImage wrapS:SFEnum wrapT:SFEnum
BumpMapCoordinate point:MFVec2f
BumpMapTransform translation:SFVec2f rotation:SFFloat scaleFactor:SFVec2f center:SFVec2f
CacheHint memValue:SFFloat gfxValue:SFFloat
Callback
CameraKit callbackList:SFNode transformGroup:SFNode transform:SFNode camera:SFNode
ClipPlane plane:SFPlane on:SFBool
ColorIndex index:MFInt32
Complexity type:SFEnum value:SFFloat textureQuality:SFFloat
Cone bottomRadius:SFFloat height:SFFloat parts:SFBitMask
Coordinate3 point:MFVec3f
Coordinate4 point:MFVec4f
Cube width:SFFloat height:SFFloat depth:SFFloat
Cylinder radius:SFFloat height:SFFloat parts:SFBitMask
DepthBuffer test:SFBool write:SFBool function:SFEnum range:SFVec2f
DirectionalLight on:SFBool intensity:SFFloat color:SFColor direction:SFVec3f
DrawStyle style:SFEnum pointSize:SFFloat lineWidth:SFFloat linePattern:SFUShort linePatternScaleFactor:SFInt32
Environment ambientIntensity:SFFloat ambientColor:SFColor attenuation:SFVec3f fogType:SFEnum fogColor:SFColor fogVisibility:SFFloat
EventCallback
FaceSet vertexProperty:SFNode startIndex:SFInt32 numVertices:MFInt32
File name:SFString
Font name:SFName size:SFFloat
FontStyle name:SFName size:SFFloat family:SFEnum style:SFBitMask
FragmentShader isActive:SFBool sourceType:SFEnum sourceProgram:SFString parameter:MFNode
FrustumCamera viewportMapping:SFEnum position:SFVec3f orientation:SFRotation nearDistance:SFFloat farDistance:SFFloat aspectRatio:SFFloat focalDistance:SFFloat top:SFFloat bottom:SFFloat left:SFFloat right:SFFloat
GeoCoordinate point:MFVec3d geoSystem:MFString
GeoLocation geoCoords:SFVec3d geoSystem:MFString
GeoOrigin geoCoords:SFVec3d geoSystem:MFString
GeoSeparator+ renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum geoCoords:SFVec3d geoSystem:MFString
GeometryShader isActive:SFBool sourceType:SFEnum sourceProgram:SFString parameter:MFNode inputType:SFEnum outputType:SFEnum maxEmit:SFInt32
Group+
Image width:SFInt32 height:SFInt32 vertAlignment:SFEnum horAlignment:SFEnum image:SFImage filename:SFString
IndexedFaceSet vertexProperty:SFNode coordIndex:MFInt32 materialIndex:MFInt32 normalIndex:MFInt32 textureCoordIndex:MFInt32
IndexedLineSet vertexProperty:SFNode coordIndex:MFInt32 materialIndex:MFInt32 normalIndex:MFInt32 textureCoordIndex:MFInt32
IndexedMarkerSet vertexProperty:SFNode coordIndex:MFInt32 materialIndex:MFInt32 normalIndex:MFInt32 textureCoordIndex:MFInt32 markerIndex:MFInt32
IndexedNurbsCurve numControlPoints:SFInt32 coordIndex:MFInt32 knotVector:MFFloat
IndexedNurbsSurface numUControlPoints:SFInt32 numVControlPoints:SFInt32 coordIndex:MFInt32 uKnotVector:MFFloat vKnotVector:MFFloat numSControlPoints:SFInt32 numTControlPoints:SFInt32 textureCoordIndex:MFInt32 sKnotVector:MFFloat tKnotVector:MFFloat
IndexedPointSet vertexProperty:SFNode coordIndex:MFInt32 materialIndex:MFInt32 normalIndex:MFInt32 textureCoordIndex:MFInt32
IndexedTriangleStripSet vertexProperty:SFNode coordIndex:MFInt32 materialIndex:MFInt32 normalIndex:MFInt32 textureCoordIndex:MFInt32
Info string:SFString
LOD+ center:SFVec3f range:MFFloat
Label label:SFName
LevelOfDetail+ screenArea:MFFloat
LightKit callbackList:SFNode transformGroup:SFNode transform:SFNode light:SFNode iconSeparator:SFNode icon:SFNode
LightModel model:SFEnum
LineSet vertexProperty:SFNode startIndex:SFInt32 numVertices:MFInt32
LinearProfile index:MFInt32 linkage:SFEnum
Listener position:SFVec3f orientation:SFRotation dopplerVelocity:SFVec3f dopplerFactor:SFFloat gain:SFFloat
LocateHighlight+ renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum color:SFColor style:SFEnum mode:SFEnum
MarkerSet vertexProperty:SFNode startIndex:SFInt32 numPoints:SFInt32 markerIndex:MFInt32
Material ambientColor:MFColor diffuseColor:MFColor specularColor:MFColor emissiveColor:MFColor shininess:MFFloat transparency:MFFloat
MaterialBinding value:SFEnum
MatrixTransform matrix:SFMatrix
MultipleCopy+ matrix:MFMatrix
NodeKitListPart containerTypeName:SFName childTypeNames:MFName containerNode:SFNode
Normal vector:MFVec3f
NormalBinding value:SFEnum
NurbsCurve numControlPoints:SFInt32 knotVector:MFFloat
NurbsProfile index:MFInt32 linkage:SFEnum knotVector:MFFloat
NurbsSurface numUControlPoints:SFInt32 numVControlPoints:SFInt32 numSControlPoints:SFInt32 numTControlPoints:SFInt32 uKnotVector:MFFloat vKnotVector:MFFloat sKnotVector:MFFloat tKnotVector:MFFloat
OrthographicCamera viewportMapping:SFEnum position:SFVec3f orientation:SFRotation nearDistance:SFFloat farDistance:SFFloat aspectRatio:SFFloat focalDistance:SFFloat height:SFFloat
PackedColor orderedRGBA:MFUInt32
PathSwitch+ path:SFPath
Pendulum rotation:SFRotation rotation0:SFRotation rotation1:SFRotation speed:SFFloat on:SFBool
PerspectiveCamera viewportMapping:SFEnum position:SFVec3f orientation:SFRotation nearDistance:SFFloat farDistance:SFFloat aspectRatio:SFFloat focalDistance:SFFloat heightAngle:SFFloat
PickStyle style:SFEnum
PointLight on:SFBool intensity:SFFloat color:SFColor location:SFVec3f
PointSet vertexProperty:SFNode startIndex:SFInt32 numPoints:SFInt32
PolygonOffset factor:SFFloat units:SFFloat styles:SFBitMask on:SFBool
ProfileCoordinate2 point:MFVec2f
ProfileCoordinate3 point:MFVec3f
QuadMesh vertexProperty:SFNode startIndex:SFInt32 verticesPerColumn:SFInt32 verticesPerRow:SFInt32
ResetTransform whatToReset:SFBitMask
ReversePerspectiveCamera viewportMapping:SFEnum position:SFVec3f orientation:SFRotation nearDistance:SFFloat farDistance:SFFloat aspectRatio:SFFloat focalDistance:SFFloat heightAngle:SFFloat
Rotation rotation:SFRotation
RotationXYZ angle:SFFloat axis:SFEnum
Rotor rotation:SFRotation speed:SFFloat on:SFBool
Scale scaleFactor:SFVec3f
SceneKit callbackList:SFNode topSeparator:SFNode cameraList:SFNode lightList:SFNode childList:SFNode
SceneTexture2 size:SFVec2s scene:SFNode sceneTransparencyType:SFNode backgroundColor:SFVec4f transparencyFunction:SFEnum wrapS:SFEnum wrapT:SFEnum model:SFEnum blendColor:SFColor type:SFEnum
Separator+ renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum
SeparatorKit callbackList:SFNode renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum topSeparator:SFNode pickStyle:SFNode appearance:SFNode units:SFNode transform:SFNode texture2Transform:SFNode childList:SFNode
ShaderParameter1f name:SFString identifier:SFInt32 value:SFFloat
ShaderParameter1i name:SFString identifier:SFInt32 value:SFInt32
ShaderParameter2f name:SFString identifier:SFInt32 value:SFVec2f
ShaderParameter2i name:SFString identifier:SFInt32 value:SFVec2i32
ShaderParameter3f name:SFString identifier:SFInt32 value:SFVec3f
ShaderParameter3i name:SFString identifier:SFInt32 value:SFVec3i32
ShaderParameter4f name:SFString identifier:SFInt32 value:SFVec4f
ShaderParameter4i name:SFString identifier:SFInt32 value:SFVec4i32
ShaderParameterArray1f name:SFString identifier:SFInt32 value:MFFloat
ShaderParameterArray1i name:SFString identifier:SFInt32 value:MFInt32
ShaderParameterArray2f name:SFString identifier:SFInt32 value:MFVec2f
ShaderParameterArray2i name:SFString identifier:SFInt32 value:MFVec2i32
ShaderParameterArray3f name:SFString identifier:SFInt32 value:MFVec3f
ShaderParameterArray3i name:SFString identifier:SFInt32 value:MFVec3i32
ShaderParameterArray4f name:SFString identifier:SFInt32 value:MFVec4f
ShaderParameterArray4i name:SFString identifier:SFInt32 value:MFVec4i32
ShaderParameterMatrix name:SFString identifier:SFInt32 value:SFMatrix
ShaderParameterMatrixArray name:SFString identifier:SFInt32 value:MFMatrix
ShaderProgram shaderObject:MFNode
ShaderStateMatrixParameter name:SFString identifier:SFInt32 matrixType:SFEnum matrixTransform:SFEnum
ShadowCulling mode:SFEnum
ShadowDirectionalLight on:SFBool intensity:SFFloat color:SFColor direction:SFVec3f shadowMapScene:SFNode maxShadowDistance:SFFloat bboxCenter:SFVec3f bboxSize:SFVec3f
ShadowGroup+ renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum isActive:SFBool intensity:SFFloat precision:SFFloat quality:SFFloat shadowCachingEnabled:SFBool visibilityNearRadius:SFFloat visibilityRadius:SFFloat epsilon:SFFloat threshold:SFFloat smoothBorder:SFFloat visibilityFlag:SFEnum
ShadowSpotLight on:SFBool intensity:SFFloat color:SFColor location:SFVec3f direction:SFVec3f dropOffRate:SFFloat cutOffAngle:SFFloat shadowMapScene:SFNode nearDistance:SFFloat farDistance:SFFloat
ShadowStyle style:SFEnum
ShapeHints vertexOrdering:SFEnum shapeType:SFEnum faceType:SFEnum creaseAngle:SFFloat
ShapeKit callbackList:SFNode renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum topSeparator:SFNode pickStyle:SFNode appearance:SFNode units:SFNode transform:SFNode texture2Transform:SFNode childList:SFNode materialBinding:SFNode normalBinding:SFNode textureCoordinateBinding:SFNode shapeHints:SFNode coordinate3:SFNode coordinate4:SFNode normal:SFNode textureCoordinate2:SFNode textureCoordinateFunction:SFNode profileCoordinate2:SFNode profileCoordinate3:SFNode profileList:SFNode localTransform:SFNode shapeSeparator:SFNode shape:SFNode
Shuttle translation:SFVec3f translation0:SFVec3f translation1:SFVec3f speed:SFFloat on:SFBool
SoSTLFileKit callbackList:SFNode topSeparator:SFNode info:SFString binary:SFBool colorization:SFEnum facets:SFNode coordinates:SFNode material:SFNode materialbinding:SFNode normals:SFNode normalbinding:SFNode texture:SFNode shapehints:SFNode
SoSceneTextureCubeMap size:SFVec2s scene:SFNode backgroundColor:SFColor transparencyFunction:SFEnum wrapS:SFEnum wrapT:SFEnum wrapR:SFEnum model:SFEnum blendColor:SFColor
Sphere radius:SFFloat
SpotLight on:SFBool intensity:SFFloat color:SFColor location:SFVec3f direction:SFVec3f dropOffRate:SFFloat cutOffAngle:SFFloat
Switch+ whichChild:SFInt32
Text2 string:MFString spacing:SFFloat justification:SFEnum
Text3 string:MFString spacing:SFFloat justification:SFEnum parts:SFBitMask
Texture2 filename:SFString image:SFImage wrapS:SFEnum wrapT:SFEnum model:SFEnum blendColor:SFColor enableCompressedTexture:SFBool
Texture2Transform translation:SFVec2f rotation:SFFloat scaleFactor:SFVec2f center:SFVec2f
Texture3 filenames:MFString images:SFImage3 wrapR:SFEnum wrapS:SFEnum wrapT:SFEnum model:SFEnum blendColor:SFColor enableCompressedTexture:SFBool
Texture3Transform translation:SFVec3f rotation:SFRotation scaleFactor:SFVec3f scaleOrientation:SFRotation center:SFVec3f
TextureCombine rgbSource:MFEnum alphaSource:MFEnum rgbOperand:MFEnum alphaOperand:MFEnum rgbOperation:SFEnum alphaOperation:SFEnum rgbScale:SFFloat alphaScale:SFFloat constantColor:SFVec4f
TextureCoordinate2 point:MFVec2f
TextureCoordinate3 point:MFVec3f
TextureCoordinateBinding value:SFEnum
TextureCoordinateCube
TextureCoordinateCylinder
TextureCoordinateDefault
TextureCoordinateEnvironment
TextureCoordinateNormalMap
TextureCoordinateObject factorS:SFVec4f factorT:SFVec4f factorR:SFVec4f factorQ:SFVec4f
TextureCoordinatePlane directionS:SFVec3f directionT:SFVec3f directionR:SFVec3f
TextureCoordinateReflectionMap
TextureCoordinateSphere
TextureCubeMap filenames:MFString imagePosX:SFImage imageNegX:SFImage imagePosY:SFImage imageNegY:SFImage imagePosZ:SFImage imageNegZ:SFImage wrapS:SFEnum wrapT:SFEnum model:SFEnum blendColor:SFColor
TextureMatrixTransform matrix:SFMatrix
TextureScalePolicy policy:SFEnum quality:SFFloat
TextureUnit unit:SFInt32 mappingMethod:SFEnum
Transform translation:SFVec3f rotation:SFRotation scaleFactor:SFVec3f scaleOrientation:SFRotation center:SFVec3f
TransformSeparator+
Translation translation:SFVec3f
TransparencyType value:SFEnum
TriangleStripSet vertexProperty:SFNode startIndex:SFInt32 numVertices:MFInt32
Units units:SFEnum
UnknownNode
VertexAttribute name:SFName typeName:SFName
VertexAttributeBinding value:SFEnum
VertexProperty vertex:MFVec3f normal:MFVec3f texCoord:MFVec2f orderedRGBA:MFUInt32 texCoord3:MFVec3f textureUnit:MFInt32 normalBinding:SFEnum materialBinding:SFEnum
VertexShader isActive:SFBool sourceType:SFEnum sourceProgram:SFString parameter:MFNode
WWWAnchor+ renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum color:SFColor style:SFEnum mode:SFEnum name:SFString description:SFString map:SFEnum
WWWInline name:SFString bboxCenter:SFVec3f bboxSize:SFVec3f alternateRep:SFNode
WrapperKit callbackList:SFNode renderCaching:SFEnum boundingBoxCaching:SFEnum renderCulling:SFEnum pickCulling:SFEnum topSeparator:SFNode pickStyle:SFNode appearance:SFNode units:SFNode transform:SFNode texture2Transform:SFNode childList:SFNode localTransform:SFNode contents:SFNode
`;
