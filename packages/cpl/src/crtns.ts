/**
 * The names of the C routines CPL can call, in cplib.c's table order
 * (Croutines). Crtn:name words hold an index into this list.
 */
export const CRTN_NAMES = [
  'slice_object',
  'setup_rotatetool',
  'snap_rotatetool',
  'xbar_rotate',
  'bauble_rotate',
  'arrange_prims',
  'arrange_toolpads',
  'near_toolbar',
  'set_picksize',
  'setup_scalebbox',
  'scalebbox_trans',
  'always_set_select',
  'reset_picksize',
  'set_light',
  'switch_light',
  'do_color',
  'control_color',
  'set_color_bars',
  'start_draw',
  'end_draw',
  'extend_draw',
  'draw_on_surface',
  'draw_line',
  'start_marquee',
  'do_zoom',
  'world_2_inch',
  'inch_2_world',
  'make_decal',
  'tool_off_plane',
  'add_obj_charstream',
  'rem_obj_charstream',
  'filter_char',
  'add_to_label',
  'label_fits',
  'backspace_label',
  'set_insertion_pt',
  'move_insertion_pt',
  'read_from_file',
  'write_to_file',
  'get_feature_size',
  'set_feature_size',
  'get_feature_dist',
  'set_feature_dist',
  'remake_piechart',
  'toggle_slide',
  'set_camera',
  'rotate_camera',
  'turnon_arrowcursor',
  'set_hiddenedge',
  'cursor_on_border',
  'normal_constrain',
  'remake_prim',
  'get_plate_by_name',
  'generate_info_rec',
  'breakup_info_rec',
  'breakup_dist_value',
  // cutplane_web's own, after the original's: an object's box as a primitive record.
  'measure_info_rec',
  // cutplane_web: a text input's label emptied (textinput.cpl's first key).
  'clear_label',
  // cutplane_web: what the saw cuts (slice.cpl): everything picked, if it's on that.
  'saw_targets',
  // cutplane_web: what the globe drops falls to the floor (gravity.cpl).
  'drop_objects',
  // cutplane_web: what the group tool groups: what is picked, if it's on that (group.cpl);
  // what a marquee takes in at least partly.
  'group_targets',
  'touching_marquee',
  // cutplane_web: a tool's size in hand, and back on its pad (tool.cpl).
  'tool_to_hand',
  'tool_to_pad',
  // cutplane_web: where D puts its copies, on from the last copy as that went on (controls).
  'place_copies',
  // cutplane_web: what ⌘A picks, each thing whole, not a scale box one is in (controls).
  'world_things',
  // cutplane_web: features the host hands CPL (controls: what R picks again).
  'handed_over',
  // cutplane_web: what is dropped in the primitives box shown smaller (toolbox.cpl), its
  // copies full size (stamp.cpl), a copy dropped back taking it out again (rom.cpl).
  'shrink_prim',
  'grow_stamp',
  'unstock_prim',
  // cutplane_web: the T chip's lettering (letter.cpl), and its plate's fields (lettering.cpl).
  'letter_on',
  'letter_color',
  'next_lettering',
  'sticker_on',
  'note_on',
  'apply_lettering',
  'close_lettering',
] as const;

export type CrtnName = (typeof CRTN_NAMES)[number];

/** cplpropfiles.rsc: the property code files ROM loads, in order. */
export const PROPERTY_FILES = [
  'Scalebbox',
  'Dialog',
  'Toolbox',
  'Tool',
  'Headpad',
  'Toolpad',
  'Padhandle',
  'Dragonly',
  'Goodies',
  'Group',
  'Stamp',
  'Colorbar',
  'Paint',
  'Inputplate',
  'Lightbulb',
  'Pencil',
  'Erase',
  'Slice',
  'Zoom',
  'Drill',
  'Textinput',
] as const;
