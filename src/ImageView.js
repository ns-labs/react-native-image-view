// @flow

import React, { Component, type Node, type ComponentType } from 'react';
import {
    ActivityIndicator,
    Animated,
    Dimensions,
    FlatList,
    Modal,
    Platform,
    Image,
    View,
    TouchableWithoutFeedback,
    Text,
    StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-navigation'
import FastImage from 'react-native-fast-image';
const AnimatedFastImage = Animated.createAnimatedComponent(FastImage);
const { width, height } = Dimensions.get("window");

import {
    addIndexesToImages,
    calculateInitialTranslate,
    fetchImageSize,
    generatePanHandlers,
    getImagesWithoutSize,
    getScale,
    getDistance,
    getInitialParams,
    scalesAreEqual,
} from './utils';

import createStyles from './styles';
import { Close, Prev, Next } from './controls';

const IMAGE_SPEED_FOR_CLOSE = 0.1;
const SCALE_MAXIMUM = 5;
const HEADER_HEIGHT = 60;
const SCALE_MAX_MULTIPLIER = 3;
const FREEZE_SCROLL_DISTANCE = 15;
const BACKGROUND_OPACITY_MULTIPLIER = 0.003;
const defaultBackgroundColor = [0, 0, 0];

const getScreenDimensions = () => ({
    screenWidth: Dimensions.get('window').width,
    screenHeight: Dimensions.get('window').height,
});

let styles = createStyles(getScreenDimensions());

export default class ImageView extends React.Component {
    static defaultProps = {
        backgroundColor: null,
        images: [],
        imageIndex: 0,
        isTapZoomEnabled: true,
        isPinchZoomEnabled: true,
        isSwipeCloseEnabled: true,
        glideAlways: false,
        glideAlwaysDelay: 75,
        controls: { prev: null, next: null },
    };

    constructor(props) {
        super(props);

        // calculate initial scale and translate for images
        const initialScreenDimensions = getScreenDimensions();
        this.imageInitialParams = props.images.map(image =>
            getInitialParams(image, initialScreenDimensions)
        );

        this.state = {
            images: props.images,
            isVisible: props.isVisible,
            imageIndex: props.imageIndex,
            imageScale: 1,
            imageTranslate: { x: 0, y: 0 },
            scrollEnabled: true,
            panelsVisible: true,
            isFlatListRerendered: false,
            screenDimensions: initialScreenDimensions,
            imageZIndex: 0,
            hideStatusBar: false,
            rotated: false,
            showClickableItems: true,
            backgroundColor: this.props.backgroundColor? this.props.backgroundColor : "#rgba(0, 0, 0, 1)",
            currentY: 0,
            isScrolling: false,
            rotating: false
        };
        this.glideAlwaysTimer = null;
        this.listRef = null;
        this.isScrolling = false;
        this.footerHeight = 0;
        this.initialTouches = [];
        this.currentTouchesNum = 0;
        this.doubleTapTimer = null;
        this.modalAnimation = new Animated.Value(0);
        this.modalBackgroundOpacity = new Animated.Value(0);

        this.headerTranslateValue = new Animated.ValueXY();
        this.footerTranslateValue = new Animated.ValueXY();

        this.imageScaleValue = new Animated.Value(this.getInitialScale());
        const { x, y } = this.getInitialTranslate();
        this.imageTranslateValue = new Animated.ValueXY({ x, y });

        this.panResponder = generatePanHandlers(
            (event): void => this.onGestureStart(event.nativeEvent),
            (event, gestureState): void =>
                this.onGestureMove(event.nativeEvent, gestureState),
            (event, gestureState): void =>
                this.onGestureRelease(event.nativeEvent, gestureState)
        );

        const imagesWithoutSize = getImagesWithoutSize(
            addIndexesToImages(props.images)
        );

        if (imagesWithoutSize.length) {
            Promise.all(fetchImageSize(imagesWithoutSize)).then(
                this.setSizeForImages
            );
        }
    }

    componentDidMount() {
        styles = createStyles(this.state.screenDimensions);
        Dimensions.addEventListener('change', this.onChangeDimension);
    }

    componentDidUpdate(prevProps) {
        if(this.props.isVisible != prevProps.isVisible || this.props.images != prevProps.images || this.props.imageIndex != prevProps.imageIndex){
            const { images, imageIndex, isVisible } = this.state;
            if (
                typeof this.props.isVisible !== 'undefined' &&
                this.props.isVisible !== isVisible
            ) {
                this.onNextImagesReceived(this.props.images, this.props.imageIndex);
    
                if (
                    images !== this.props.images ||
                    imageIndex !== this.props.imageIndex
                ) {
                    const imagesWithoutSize = getImagesWithoutSize(
                        addIndexesToImages(this.props.images)
                    );
    
                    if (imagesWithoutSize.length) {
                        Promise.all(fetchImageSize(imagesWithoutSize)).then(
                            updatedImages =>
                                this.onNextImagesReceived(
                                    this.setSizeForImages(updatedImages),
                                    this.props.imageIndex
                                )
                        );
                    }
                }
    
                this.setState({
                    isVisible: this.props.isVisible,
                    isFlatListRerendered: false,
                });
    
                this.modalBackgroundOpacity.setValue(0);
    
                if (this.props.isVisible) {
                    Animated.timing(this.modalAnimation, {
                        duration: 400,
                        toValue: 1,
                    }).start();
                }
            }
        } else if(this.props.backgroundColor != prevProps.backgroundColor) {
            this.setState({
                backgroundColor: this.props.backgroundColor? this.props.backgroundColor : "#rgba(0, 0, 0, 1)",
            })
        }
    }

    componentWillUnmount() {
        Dimensions.removeEventListener('change', this.onChangeDimension);

        if (this.glideAlwaysTimer) {
            clearTimeout(this.glideAlwaysTimer);
        }
    }

    onChangeDimension = ({ window }) => {
        this.setState({
            rotating: true
        });
        const screenDimensions = {
            screenWidth: window.width,
            screenHeight: window.height,
        };
        if (window.width > window.height) {
            this.setState({
                rotated: true
            })
        } else {
            this.setState({
                rotated: false
            })
        }

        this.setState({ screenDimensions });
        styles = createStyles(screenDimensions);
        this.onNextImagesReceived(this.props.images, this.state.imageIndex);
        if (this.listRef) {
            this.listRef.scrollToIndex({
                index: this.state.imageIndex,
                animated: false,
            });
            let index = this.state.imageIndex;
            const nextTick = new Promise(resolve => setTimeout(resolve, 0));
            nextTick.then(async () => {
                await this.listRef.scrollToIndex({
                    index: index,
                    animated: false,
                });
                this.setState({
                    rotating: false
                })
            })

        }

    };

    onNextImagesReceived(images: Array, imageIndex: number = 0) {
        this.imageInitialParams = images.map(image =>
            getInitialParams(image, this.state.screenDimensions)
        );
        const { scale, translate } = this.imageInitialParams[imageIndex] || {
            scale: 1,
            translate: {},
        };

        this.setState({
            images,
            imageIndex,
            imageScale: scale,
            imageTranslate: translate,
            isFlatListRerendered: false,
        });

        this.imageScaleValue.setValue(scale);
        this.imageTranslateValue.setValue(translate);
    }

    // $FlowFixMe
    onFlatListRender = flatListRef => {
        const { images, imageIndex, isFlatListRerendered } = this.state;

        if (flatListRef && !isFlatListRerendered) {
            this.listRef = flatListRef;
            this.setState({
                isFlatListRerendered: true,
            });

            // Fix for android https://github.com/facebook/react-native/issues/13202
            if (images.length > 0) {
                const nextTick = new Promise(resolve => setTimeout(resolve, 0));
                nextTick.then(() => {
                    flatListRef.scrollToIndex({
                        index: imageIndex,
                        animated: false,
                    });
                });
            }
        }
    };

    onNextImage = (event) => {
        const { imageIndex } = this.state;
        const { x } = event.nativeEvent.contentOffset || { x: 0 };

        const nextImageIndex = Math.round(
            x / this.state.screenDimensions.screenWidth
        );

        this.isScrolling =
            Math.ceil(x) % this.state.screenDimensions.screenWidth > 10;

        if (imageIndex !== nextImageIndex && nextImageIndex >= 0) {
            const nextImageScale = this.getInitialScale(nextImageIndex);
            const nextImageTranslate = this.getInitialTranslate(nextImageIndex);

            this.setState({
                imageIndex: nextImageIndex,
                imageScale: nextImageScale,
                imageTranslate: nextImageTranslate,
            });

            this.imageScaleValue.setValue(nextImageScale);
            this.imageTranslateValue.setValue(nextImageTranslate);
        }
    };

    onGestureStart(event) {
        this.initialTouches = event.touches;
        this.currentTouchesNum = event.touches.length;
    }

    /**
     * If image is moved from its original position
     * then disable scroll (for ScrollView)
     */
    onGestureMove(event, gestureState) {
        this.setState({ imageZIndex: 150 })

        if (this.currentTouchesNum === 1 && event.touches.length === 2) {
            this.initialTouches = event.touches;
        }

        const { isSwipeCloseEnabled, isPinchZoomEnabled } = this.props;

        const {
            images,
            imageIndex,
            imageScale,
            imageTranslate,
            screenDimensions,
        } = this.state;
        const { screenHeight } = screenDimensions;
        const { touches } = event;
        const { x, y } = imageTranslate;
        const { dx, dy } = gestureState;
        const imageInitialScale = this.getInitialScale();
        const { height } = images[imageIndex];

        if (imageScale !== imageInitialScale) {
            this.imageTranslateValue.x.setValue(x + dx);
        }

        // Do not allow to move image vertically until it fits to the screen
        if (imageScale * height > screenHeight) {
            this.imageTranslateValue.y.setValue(y + dy);
        }
        // if image not scaled and fits to the screen
        if (
            isSwipeCloseEnabled &&
            height * imageInitialScale < screenHeight
        ) {
            const backgroundOpacity = Math.abs(
                dy * BACKGROUND_OPACITY_MULTIPLIER
            );
            this.modalBackgroundOpacity.setValue(
                backgroundOpacity > 1 ? 1 : backgroundOpacity
            );
            this.setState({
                currentY: dy
            })
            if(Math.abs(dy) > 20) {
                this.setState({
                    backgroundColor: this.props.backgroundColor ? this.extractBackgroundAndAddOpacity(this.props.backgroundColor, (1 - Math.abs(dy / 100))): "#rgba(0, 0, 0, " + (1 - Math.abs(dy / 100)) + ")"
                })
            }
        }

        const currentDistance = getDistance(touches);
        const initialDistance = getDistance(this.initialTouches);

        const scrollEnabled = Math.abs(dy) < FREEZE_SCROLL_DISTANCE;
        this.setState({ scrollEnabled });

        if (!initialDistance) {
            return;
        }

        if (!isPinchZoomEnabled || touches.length < 2) {
            return;
        }

        let nextScale = getScale(currentDistance, initialDistance) * imageInitialScale;

        if (nextScale < imageInitialScale) {
            nextScale = imageInitialScale;
        }
        if (nextScale != imageInitialScale) {
            this.setState({
                hideStatusBar: true
            })
        }
        // else if (nextScale > SCALE_MAXIMUM) {
        //     nextScale = SCALE_MAXIMUM;
        // }

        this.imageScaleValue.setValue(nextScale);
        this.currentTouchesNum = event.touches.length;
    }

    extractBackgroundAndAddOpacity(backgroundColor, opacity) {
        if(backgroundColor.includes('rgba')) {
            return backgroundColor.substring(0, backgroundColor.lastIndexOf(',') + 1) + opacity + ')'
        } else {
            return backgroundColor.substring(0, backgroundColor.lastIndexOf(')')) + opacity + ')'
        }
    }

    onGestureRelease(event, gestureState) {
        this.setState({ imageZIndex: 0 })
        if (this.glideAlwaysTimer) {
            clearTimeout(this.glideAlwaysTimer);
        }
        const imageInitialScale = this.getInitialScale();
        this.imageScaleValue.setValue(imageInitialScale);
        this.setState({
            hideStatusBar: false
        });
        const { imageScale } = this.state;
        const { dx, dy, vy } = gestureState;
        const { isSwipeCloseEnabled } = this.props;
        const { x, y } = this.calculateNextTranslate(dx, dy, imageScale);
        if (
            isSwipeCloseEnabled &&
            // scale === imageInitialScale &&
            Math.abs(dy) >= 60
            && !this.state.isScrolling
        ) {
            Animated.timing(this.imageTranslateValue.y, {
                toValue: y + 400 * vy,
                duration: 100,
            }).start(this.close);
        } else {
            this.setState({
                backgroundColor: this.props.backgroundColor ? this.props.backgroundColor : "#rgba(0, 0, 0, 1)",
                currentY: 0
            })
        }
    }

    onImageLoaded(index: number) {
        Image.getSize(this.state.images[index].source.uri, (width, height) => {

            const { images } = this.state;

            images[index] = { ...images[index], loaded: true, width: width, height: height };

            this.setState({ images });
        });
    }

    onMomentumScrollBegin = () => {
        this.isScrolling = true;
        this.setState({
            isScrolling: true
        })
        if (this.glideAlwaysTimer) {
            // If FlatList started gliding then prevent glideAlways scrolling
            clearTimeout(this.glideAlwaysTimer);
        }
    };

    onMomentumScrollEnd = () => {
        this.isScrolling = false;
        this.setState({
            isScrolling: false
        })
    };

    getItemLayout = (_: *, index: number): Object => {
        const { screenWidth } = this.state.screenDimensions;

        return { length: screenWidth, offset: screenWidth * index, index };
    };

    getInitialScale(index?: number): number {
        const imageIndex = index !== undefined ? index : this.state.imageIndex;
        const imageParams = this.imageInitialParams[imageIndex];
        return imageParams ? imageParams.scale : 1;
    }

    getInitialTranslate(index?: number) {
        const imageIndex = index !== undefined ? index : this.state.imageIndex;
        const imageParams = this.imageInitialParams[imageIndex];

        return imageParams ? imageParams.translate : { x: 0, y: 0 };
    }

    getImageStyle(
        image,
        index: number
    ): { width?: number, height?: number, transform?: any, opacity?: number } {
        const { imageIndex, screenDimensions } = this.state;
        if(image.width < getScreenDimensions().screenWidth && image.height < getScreenDimensions().screenHeight && ( image.width > 200 || image.height > 200)) {
            widthDiff = getScreenDimensions().screenWidth - image.width;
            heightDiff = getScreenDimensions().screenHeight - image.height;
            if(widthDiff<heightDiff) {
                aspectRatio = image.width / image.height
                image.width = getScreenDimensions().screenWidth
                image.height = image.width / aspectRatio
            }
            else {
                aspectRatio = image.height / image.width
                image.height = getScreenDimensions().screenHeight
                image.width = image.height / aspectRatio
            }
        }
        const { width, height } = image;
        if (!width || !height) {
            return { opacity: 0, height: 1 };//passing height as 1 since IOS checks whether their is width and heigth, if no returns nulls
        }

        // very strange caching, fix it with changing size to 1 pixel
        const { x, y } = calculateInitialTranslate(
            width,
            height + 1,
            screenDimensions
        );
        const translateValue = new Animated.ValueXY({ x, y });
        // const transform = translateValue.getTranslateTransform();
        const transform =
            index !== imageIndex
                ? this.imageTranslateValue.getTranslateTransform()
                : translateValue.getTranslateTransform();
        const scale =
            index === imageIndex
                ? this.imageScaleValue
                : this.getInitialScale(index);
        // $FlowFixMe
        transform.push({ scale });
        return { width, height, transform };
    }

    getControls = () => {
        const { close, prev, next } = this.props.controls;
        const controls = { close: Close, prev: undefined, next: undefined };

        if (close === null) {
            controls.close = null;
        }

        if (close) {
            controls.close = close === true ? Close : close;
        }

        if (prev) {
            controls.prev = prev === true ? Prev : prev;
        }

        if (next) {
            controls.next = next === true ? Next : next;
        }

        return controls;
    };

    setSizeForImages = (nextImages: Array): Array => {
        if (nextImages.length === 0) {
            return [];
        }

        const { images } = this.state;

        var updatedImages = images.map((image, index) => {
            const nextImageSize = nextImages.find(
                nextImage => nextImage.index === index
            );

            /* eslint-disable */
            if (nextImageSize) {
                image.width = nextImageSize.width;
                image.height = nextImageSize.height;
            }
            /* eslint-enable */

            return image;
        });
        this.onNextImagesReceived(updatedImages, this.props.imageIndex);
        this.setState({
            images: updatedImages
        })
    };

    scrollToNext = () => {
        if (this.listRef && typeof this.listRef.scrollToIndex === 'function') {
            this.listRef.scrollToIndex({
                index: this.state.imageIndex + 1,
                animated: true,
            });
        }
    };

    scrollToPrev = () => {
        if (this.listRef && typeof this.listRef.scrollToIndex === 'function') {
            this.listRef.scrollToIndex({
                index: this.state.imageIndex - 1,
                animated: true,
            });
        }
    };

    imageInitialParams;
    glideAlwaysTimer: ?TimeoutID;
    listRef: *;
    isScrolling: boolean;
    footerHeight: number;
    initialTouches;
    currentTouchesNum: number;
    doubleTapTimer: ?TimeoutID;
    modalAnimation: *;
    modalBackgroundOpacity: *;
    headerTranslateValue: *;
    footerTranslateValue: *;
    imageScaleValue: *;
    imageTranslateValue: *;
    panResponder: *;

    calculateNextTranslate(
        dx: number,
        dy: number,
        scale: number
    ): { x: number, y: number } {
        const {
            images,
            imageIndex,
            imageTranslate,
            screenDimensions,
        } = this.state;
        const { x, y } = imageTranslate;
        const { screenWidth, screenHeight } = screenDimensions;
        const { width, height } = images[imageIndex];
        const imageInitialScale = this.getInitialScale();

        const getTranslate = (axis: string): number => {
            const imageSize = axis === 'x' ? width : height;
            const screenSize = axis === 'x' ? screenWidth : screenHeight;
            const leftLimit = (scale * imageSize - imageSize) / 2;
            const rightLimit = screenSize - imageSize - leftLimit;

            let nextTranslate = axis === 'x' ? x + dx : y + dy;

            // Less than the screen
            if (screenSize > scale * imageSize) {
                if (width >= height) {
                    nextTranslate = (screenSize - imageSize) / 2;
                } else {
                    nextTranslate =
                        screenSize / 2 -
                        (imageSize * (scale / imageInitialScale)) / 2;
                }

                return nextTranslate;
            }

            if (nextTranslate > leftLimit) {
                nextTranslate = leftLimit;
            }

            if (nextTranslate < rightLimit) {
                nextTranslate = rightLimit;
            }

            return nextTranslate;
        };

        return { x: getTranslate('x'), y: getTranslate('y') };
    }

    togglePanels(isVisible?: boolean) {
        const panelsVisible =
            typeof isVisible !== 'undefined'
                ? isVisible
                : !this.state.panelsVisible;
        // toggle footer and header
        this.setState({ panelsVisible });

        Animated.timing(this.headerTranslateValue.y, {
            toValue: !panelsVisible ? -HEADER_HEIGHT : 0,
            duration: 200,
            useNativeDriver: true,
        }).start();

        if (this.footerHeight > 0) {
            Animated.timing(this.footerTranslateValue.y, {
                toValue: !panelsVisible ? this.footerHeight : 0,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }
    }

    listKeyExtractor = (image): string =>
        this.state.images.indexOf(image).toString();

    close = () => {
        this.setState({
            isVisible: false,
            backgroundColor: this.props.backgroundColor ? this.props.backgroundColor : "#rgba(0, 0, 0, 1)",
            showClickableItems: true,
            currentY: 0
        });

        if (typeof this.props.onClose === 'function') {
            this.props.onClose();
        }

        this.props.onClose()
    };

    renderImage = ({ item: image, index }: { item: *, index: number }): * => {
        return (
            <View {...this.panResponder.panHandlers}>
                <TouchableWithoutFeedback
                    style={[styles.imageContainer, { zIndex: 5 }]}
                    onStartShouldSetResponder={(): boolean => true}
                    onPress={() => this.setState(prevState => ({ showClickableItems: !prevState.showClickableItems }))}
                    {...this.panResponder.panHandlers}
                >
                    <View
                        style={[styles.imageContainer]}
                        onStartShouldSetResponder={(): boolean => true}
                    >
                        <TouchableWithoutFeedback
                            onPress={() => this.setState(prevState => ({ showClickableItems: !prevState.showClickableItems }))}
                            {...this.panResponder.panHandlers}
                        >
                            <Animated.Image
                                resizeMode="cover"
                                source={image.source}
                                style={[this.getImageStyle(image, index), { top: this.state.currentY }]}
                                onLoad={(): void => this.onImageLoaded(index)}
                                {...this.panResponder.panHandlers}
                                onError={(error): void => {
                                    const { images } = this.state;
                                    images[index] = { ...images[index], error: true };
                                    this.setState({ images });
                                }}
                            />
                        </TouchableWithoutFeedback>
                        {!(this.state.images[index].loaded && this.state.images[index].width && this.state.images[index].height) ? this.state.images[index].error ? this.props.showOnError : <ActivityIndicator style={styles.loading} color={this.props.activityIndicatorColor}/> : null}
                    </View>
                </TouchableWithoutFeedback>
            </View>
        );
    };
    content() {
        const { animationType, renderFooter, backgroundColor } = this.props;
        const {
            images,
            imageIndex,
            imageScale,
            isVisible,
            scrollEnabled,
        } = this.state;

        const { close, prev, next } = this.getControls();
        const imageInitialScale = this.getInitialScale();

        const isPrevVisible =
            imageScale === imageInitialScale && imageIndex > 0;
        const isNextVisible =
            imageScale === imageInitialScale && imageIndex < images.length - 1;
        return (
            <View style={{ flex: 1, backgroundColor: 'transparent' }}>
                <SafeAreaView
                    style={[
                        styles.header,
                        {
                            backgroundColor: 'transparent'
                        },
                    ]}
                >
                    {!this.state.hideStatusBar && this.state.showClickableItems ? this.props.renderHeader : null}
                </SafeAreaView>
                <FlatList
                    horizontal
                    pagingEnabled
                    data={images}
                    scrollEnabled={!this.state.hideStatusBar}
                    scrollEventThrottle={16}
                    style={{ zIndex: this.state.imageZIndex, position: 'absolute' }}
                    ref={this.onFlatListRender}
                    renderSeparator={() => null}
                    keyExtractor={this.listKeyExtractor}
                    onScroll={this.onNextImage}
                    renderItem={this.renderImage}
                    getItemLayout={this.getItemLayout}
                    onMomentumScrollBegin={this.onMomentumScrollBegin}
                    onMomentumScrollEnd={this.onMomentumScrollEnd}
                />
                {
                    this.props.showMoreText ?
                        <View style={{ position: 'absolute', width: Dimensions.get('window').width, height: Dimensions.get('window').height, backgroundColor: this.props.backgroundColorOnShowMore, zIndex: 10 }} /> :
                        null
                }
                {prev &&
                    isPrevVisible &&
                    React.createElement(prev, { onPress: this.scrollToPrev })}
                {next &&
                    isNextVisible &&
                    React.createElement(next, { onPress: this.scrollToNext })}
                {renderFooter && !this.state.hideStatusBar && this.state.showClickableItems && (
                    <SafeAreaView
                        style={[styles.footer]}
                    >
                        {typeof renderFooter === 'function' &&
                            images[imageIndex] &&
                            renderFooter(images[imageIndex])}
                    </SafeAreaView>
                )}
            </View>
        )
    }

    render(): Node {
        const { animationType, renderFooter, backgroundColor } = this.props;
        const {
            images,
            imageIndex,
            imageScale,
            isVisible,
            scrollEnabled,
        } = this.state;

        const { close, prev, next } = this.getControls();
        const imageInitialScale = this.getInitialScale();

        const isPrevVisible =
            imageScale === imageInitialScale && imageIndex > 0;
        const isNextVisible =
            imageScale === imageInitialScale && imageIndex < images.length - 1;

        return (
            <Modal
                transparent
                visible={isVisible}
                animationType={animationType}
                onRequestClose={() => { }}
                supportedOrientations={['portrait', 'landscape']}

            >
                <View style={{ flex: 1, backgroundColor: this.state.backgroundColor, }}>
                {
                    Platform.OS === 'ios' ?
                    <StatusBar hidden={true}/> : null
                }
                    {this.content()}
                </View>
            </Modal>
        );
    }
}
