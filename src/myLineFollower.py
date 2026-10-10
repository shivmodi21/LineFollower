# Explanation:
# In this method I made 7 sensors in front of car that detect colour of path. The controller compare 
# colours(which sensors get) with road(path) colour and try to make less differance in colour to run car in path. 
# Basically error = sensor colour - roadline colour

# Note: 
# 1) While testing please start drawing line from bottom-left grey box and draw the line, then car starts fllow that line till end points
# 2) Don't draw direct horizontal line (theta from horizontal should be > 45 degrees ) from start box because car doesn't make sharp turn.
# 4) Put your car_icon_path in code



import pygame
import numpy as np

car_icon_path = "D:\Control Theory\Week2\imgs\icon.png"

class Car(pygame.sprite.Sprite):
    posX = 100  # X position of the sprite
    posY = 100  # Y position of the sprite
    angle = 0  # the angle by which the robot is rotated
    detColor = (255, 159, 0, 255)  # color of the sensor housing

    DefaultPow = 4  # default value for driving forward
    PIDratio = 5  # default value for a turn

    vectorDir = (0.0, -1.0)  # vector direction

    vectorDet1 = (-18.0, -19.0)  # vector from the center of the sprite to the "measurement" point 1
    vectorDet2 = (-14.0, -23.0)  # vector from the center of the sprite to the "measurement" point 3
    vectorDet3 = (-8.0, -25.0)  # vector from the center of the sprite to the "measurement" point 4
    vectorDet4 = (-1.0, -27.0)  # vector from the center of the sprite to the "measurement" point 5
    vectorDet5 = (7.0, -25.0)  # vector from the center of the sprite to the "measurement" point 6
    vectorDet6 = (13.0, -23.0)  # vector from the center of the sprite to the "measurement" point 7
    vectorDet7 = (17.0, -19.0)  # vector from the center of the sprite to the "measurement" point 8

    idAct = 0
    idLast = 0

    startPos = (-20, 0)

    def __init__(self):  # initialization
        pygame.sprite.Sprite.__init__(self)
        self.posX = 0
        self.posY = 0
        self.angle = 0
        self.image = pygame.image.load(car_icon_path)
        self.orginal_image = self.image
        self.rect = self.image.get_rect()

    def draw(self, screen):  # drawing a robot
        screen.blit(self.image, (self.posX, self.posY))


    def drawDot(self, vector, screen):
        a, b = self.rect.center
        x, y = self.rotate_point(vector)
        pygame.draw.rect(screen, (0, 0, 0), pygame.Rect(a + x, b + y, 2, 2))

    def rot(self, angle):  # rotation of the robot by angle, determination of a new vector directions and its normalization
        self.angle += angle
        self.angle = self.angle % 360
        self.dirVector_normalize()
        self.image = pygame.transform.rotate(self.orginal_image, self.angle)
        self.rect = self.image.get_rect()

    def update(self):  # Method of the Sprite class
        self.rot(0)
        pass

    # Robot shift with a given "Power" value, according to the direction,
    # Power > 0 - forward
    # Power < 0 - back
    def forward(self, power):
        x, y = self.vectorDir
        self.posY += y * power
        self.posX += x * power

    # Turning the color at the place "measurement" with the amendment (i, j) - resulting from approximations
    def detecColor(self, screen, vector, i, j):
        a, b = self.rect.center
        x, y = vector
        p, q = self.rotate_point((x + i, y + j))
        color = screen.get_at((int(self.posX + int(a + p)), int(self.posY + int(b + q))))
        return color

    # The picture turns make the color interpoluits and it is not exactly as set at the beginning
    # Color I recognize as "the same" if the component difference is less than 20
    # In order to avoid mistakes I chose expressive bright colors
    def colorSimilar(self, colorA, colorB):
        r, g, b, a = colorA
        x, y, z, a = colorB
        d = np.abs(r - x) + np.abs(g - y) + np.abs(b - z)
        return d < 20

    # Returning the measured color, with the correction to measure the color from the robot
    def colorDetector(self, screen, vector):
        color = self.detecColor(screen, vector, 0, 0)
        if self.colorSimilar(color,self.detColor):
            color = self.detecColor(screen, vector, 0, 1)
            if self.colorSimilar(color,self.detColor):
                color = self.detecColor(screen, vector, 1, 1)
                if self.colorSimilar(color,self.detColor):
                    color = self.detecColor(screen, vector, 1, 0)
                    if self.colorSimilar(color, self.detColor):
                        color = self.detecColor(screen, vector, 1, -1)
                        if self.colorSimilar(color, self.detColor):
                            color = self.detecColor(screen, vector, 0, -1)
                            if self.colorSimilar(color, self.detColor):
                                color = self.detecColor(screen, vector, -1, -1)
                                if self.colorSimilar(color, self.detColor):
                                    color = self.detecColor(screen, vector, -1, 0)
                                    if self.colorSimilar(color, self.detColor):
                                        color = self.detecColor(screen, vector, -1, -1)
        return color

    # Create a new vector, we create a new one and we do not transform the previous one to overcome the effect of rounding
    def dirVector_normalize(self):
        x, y = (0, -1)
        xp = x * np.cos(np.deg2rad(-self.angle)) - y * np.sin(np.deg2rad(-self.angle))
        yp = x * np.sin(np.deg2rad(-self.angle)) + y * np.cos(np.deg2rad(-self.angle))
        d = np.sqrt(xp * xp + yp * yp)
        xp = xp / d
        yp = yp / d
        self.vectorDir = (xp, yp)

    # Determination of the position of the measurement point
    def rotate_point(self, vec):
        x, y = vec
        xp = x * np.cos(np.deg2rad(-self.angle)) - y * np.sin(np.deg2rad(-self.angle))
        yp = x * np.sin(np.deg2rad(-self.angle)) + y * np.cos(np.deg2rad(-self.angle))
        return xp, yp

    # Tracking algorithm Ruling
    def follow(self, screen, line_color, end_color, background_c):

        if not self.searchEnd(end_color, screen):

            change = self.PIDratio * self.calcError(line_color, screen)         # PID signal term
            self.forward(self.DefaultPow)
            self.rot(change)                                                    # Rotate car according to angle differance
            return False
        else:
            return True

    def print(self, screen):
        pass

    def searchEnd(self, color_end, screen):
        color = list()
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet1)))
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet2)))
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet3)))
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet4)))
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet5)))
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet6)))
        color.append(self.colorSimilar(color_end, self.colorDetector(screen, self.vectorDet7)))

        for i in range(0, 6):
            if color[i]:
                return True

        return False

    def calcError(self, lineColor, screen):
        color = list()
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet1)))
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet2)))
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet3)))
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet4)))
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet5)))
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet6)))
        color.append(self.colorSimilar(lineColor, self.colorDetector(screen, self.vectorDet7)))

        reading = 0
        sum = 0

        for i in range(0, 6):
            if color[i]:
                sum += i - 3
                reading += 1
        if reading > 0:
            error = sum / reading
        else:
            error = 0
        return -error

pygame.init()
screen = pygame.display.set_mode((600, 600))
done = False  # Flag signaling the closure of the program
drawing = False  # Flag checking whether the line is drawn
line_pos = list()  # A list containing the position of the drawn line
line_color = (255, 0, 0,255)  # color drawn ruler,
background_c = (200, 200, 200, 255)  # background color
start_c = (150, 150, 150, 255)  # Color of the startover field
end_color = (100, 255, 100, 255)  # The color of the finish line
car = Car()  # Sprite symbolizing the robot
line_width = 5  # width line


def clear_screen():  # Method drawn light gray background
    screen.fill(background_c)
    pygame.draw.rect(screen, start_c, pygame.Rect(0, 550, 50, 50))


def reset_line(): # Resetting the line
    line_pos.clear()


def draw_line():  # Line drawing
    if len(line_pos) > 1:
        pygame.draw.lines(screen, line_color, False, line_pos, line_width)
        x, y = line_pos[len(line_pos) - 1]
        pygame.draw.rect(screen, end_color, pygame.Rect(x, y, 10, 10))


clock = pygame.time.Clock()
start = False
while not done:  # Loop of the Program

   # Loop of events captured by the program window
    for event in pygame.event.get():

        if event.type == pygame.QUIT:  # Close the program
            done = True

        if event.type == pygame.MOUSEBUTTONDOWN:  #Pressing the mouse button, start drawing a line
            reset_line()
            drawing = True
            pygame.mouse.set_pos(25, 550)
            start = False

        if event.type == pygame.MOUSEMOTION and drawing:  # Moving with a mouse pressed on the key, drawing the line
            line_pos.append(pygame.mouse.get_pos())

        if event.type == pygame.MOUSEBUTTONUP:  #Release key, drawing
            drawing = False
            x, y = line_pos[0]
            a, b = car.startPos
            car.posX, car.posY = x + a, y + b
            car.angle = 0
            start = True

    # ============================

    clear_screen()
    draw_line()
    car.draw(screen)
    if start:
        start = not car.follow(screen, line_color, end_color, background_c)
    pygame.display.flip()
    car.update()

    clock.tick(50)

# ============================