// The reader is only allowed to return words from a lexicon: the words an exercise
// expects, plus this general list. The learner-error entries at the bottom are
// deliberate — if someone writes "goed", we want the app to read "goed" and mark it
// wrong, not to snap the ink onto the nearest correct answer.

const EVERYDAY = `
a an the and or but not no yes very too also just only then than there here
i you he she it we they me him her us them my your his its our their
am is are was were be been being do does did done doing have has had having
go goes going went gone come comes came get gets got make makes made
say says said see sees saw seen take takes took know knows knew think thinks thought
want wants wanted give gives gave find finds found tell tells told work works worked
call calls called try tries tried ask asks asked need needs needed feel feels felt
become leave leaves left put puts mean means meant keep keeps kept let lets
begin begins began seem seems seemed help helps helped talk talks talked turn turns
start starts started show shows showed hear hears heard play plays played
run runs ran move moves moved live lives lived believe hold holds held
bring brings brought happen happens happened write writes wrote sit sits sat
stand stands stood lose loses lost pay pays paid meet meets met include
learn learns learnt learned change changes changed lead leads led understand
watch watches watched follow follows followed stop stops stopped create speak
read reads spend spends spent grow grows grew open opens opened walk walks walked
win wins won teach teaches taught offer remember consider appear buy buys bought
serve die dies died send sends sent build builds built stay stays stayed fall falls fell
cut cuts reach kill raise pass sell sells sold decide return explain hope carry break
receive agree support hit produce eat eats ate drink drinks drank sleep sleeps slept
study studies studied carry carries carried fly flies flew cry cries cried try
finish finishes finished wash washes washed fix fixes fixed miss misses missed
teach catch catches caught brush brushes brushed touch touches touched
man men woman women child children person people foot feet tooth teeth mouse mice
box boxes glass glasses dish dishes bus buses class classes watch city cities
baby babies country countries story stories family families party parties
knife knives leaf leaves wife wives life lives shelf shelves
day days week weeks month months year years hour hours minute minutes
time times house houses home school schools work office room rooms door doors
book books pen pens pencil table chair chairs window windows car cars
water food bread milk tea coffee apple apples dog dogs cat cats bird birds
friend friends teacher teachers student students name names city town
morning evening night afternoon today tomorrow yesterday now soon later
good better best bad worse worst big bigger biggest small smaller smallest
old older oldest new newer newest young younger youngest tall taller tallest
happy happier happiest easy easier easiest busy busier busiest hot hotter hottest
long longer longest short shorter shortest nice nicer nicest fast faster fastest
beautiful expensive interesting difficult important popular famous careful
more most less least many much few little some any every all both each
in on at to from by with about for of into over under between behind next near
up down out off again always never often sometimes usually rarely ever yet still
can could will would shall should may might must ought
who what where when why how which whose whom
this that these those mine yours ours theirs myself yourself himself herself
switch switches socket sockets plug plugs cable cables fuse fuses wire wires
lamp lamps battery batteries charger chargers screen screens button buttons
`;

// Endings and forms learners reach for first. Keeping them readable keeps the
// feedback honest: the app can say what it actually saw.
const LEARNER_ERRORS = `
goed gos goe watchs watchies plaies playes studyed studys studing tryed
boxs boxies childs childrens mans mens womans foots tooths mouses knifes
runned comed taked maked getted eated drinked buyed catched teached
haves dos beed amn't isnt arent dont doesnt didnt cant wont
more big more good gooder baddest bestest happyer bigest fastes
a apple an dog the a much apples many water
`;

const clean = (block) =>
  block
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

export const COMMON_WORDS = [...new Set([...clean(EVERYDAY), ...clean(LEARNER_ERRORS)])];
